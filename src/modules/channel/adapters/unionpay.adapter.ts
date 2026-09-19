import * as crypto from 'node:crypto';
import axios from 'axios';
import { Logger } from '@nestjs/common';
import {
  BillRow,
  ChannelAdapter,
  CreatePaymentParams,
  CreatePaymentResult,
  DownloadBillParams,
  ParsedNotify,
  QueryPaymentResult,
  QueryRefundResult,
  RefundParams,
  RefundResult,
} from '../channel.types';
import { Channel, TradeType } from '../../../common/constants/enums';

/** 银联全渠道支付平台（ACP）网关 */
const UNIONPAY_GATEWAY = {
  prod: 'https://gateway.95516.com',
  test: 'https://gateway.test.95516.com',
};

const VERSION = '5.1.0';

/** 银联应答码（respCode / origRespCode） */
const RESP = {
  SUCCESS: '00',
  NO_ORIGINAL: '34', // 查询时原交易不存在
  DRAWBACK: 'Z0', // 隔日撤销需走退货
};

/**
 * 银联（云闪付 / 银行卡收单）适配器，按银联全渠道支付平台 ACP 规范实现
 *
 * 依赖配置：
 * - mchId          银联商户号 merId（15 位）
 * - certSerialNo   签名证书 ID（certId）
 * - privateKey     签名私钥 PEM（与证书 ID 成对）
 * - platformCert   银联签名公钥证书 PEM（验签用）
 *
 * ⚠️ 上线前务必先在银联测试环境（gateway.test.95516.com，isSandbox=true）完成全链路联调。
 */
export class UnionPayAdapter implements ChannelAdapter {
  readonly channel = Channel.UNIONPAY;
  readonly mchId: string;
  readonly isSandbox: boolean;
  private readonly logger = new Logger(UnionPayAdapter.name);

  private readonly certId: string;
  private readonly privateKey: string;
  private readonly platformCert: string;
  private readonly frontUrl: string;

  constructor(config: {
    mchId: string;
    certSerialNo?: string;
    privateKey?: string;
    platformCert?: string;
    isSandbox?: boolean;
    extra?: Record<string, any>;
  }) {
    this.mchId = config.mchId;
    this.certId = config.certSerialNo || '';
    this.privateKey = config.privateKey || '';
    this.platformCert = config.platformCert || '';
    this.isSandbox = !!config.isSandbox;
    this.frontUrl = config.extra?.frontUrl || process.env.PAY_BASE_URL || '';
  }

  private get gateway(): string {
    return this.isSandbox ? UNIONPAY_GATEWAY.test : UNIONPAY_GATEWAY.prod;
  }

  private assertReady() {
    if (!this.mchId || !this.certId || !this.privateKey) {
      throw new Error('银联配置不完整：缺少 merId / 证书 ID / 签名私钥');
    }
  }

  // ==================== 签名 / 验签 ====================

  /** 待签名串：除 signature 外按字段名 ASCII 升序 key=value& 拼接，空值域不参与 */
  private signContent(data: Record<string, string>): string {
    return Object.keys(data)
      .filter((k) => k !== 'signature' && data[k] !== '' && data[k] !== undefined && data[k] !== null)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('&');
  }

  private sign(data: Record<string, string>): Record<string, string> {
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(this.signContent(data), 'utf8')
      .sign(this.privateKey, 'base64');
    return { ...data, certId: this.certId, signature };
  }

  private verify(data: Record<string, string>): boolean {
    if (!data.signature) return false;
    if (!this.platformCert) {
      this.logger.warn('[unionpay] 未配置验签证书，无法验答回调（生产必须配置！）');
      return false;
    }
    return crypto
      .createVerify('RSA-SHA256')
      .update(this.signContent(data), 'utf8')
      .verify(this.platformCert, data.signature, 'base64');
  }

  /** 后台接口（backTransReq.do）：JSON 应答 */
  private async call(data: Record<string, string>): Promise<Record<string, string>> {
    this.assertReady();
    const signed = this.sign(data);
    const resp = await axios.post(`${this.gateway}/gateway/api/backTransReq.do`, new URLSearchParams(signed), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      timeout: 15000,
      responseType: 'text',
    });
    const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    const parsed = JSON.parse(body) as Record<string, string>;
    if (this.platformCert && parsed.signature && !this.verify(parsed)) {
      this.logger.warn('[unionpay] 应答验签未通过，请检查验签证书配置');
    }
    return parsed;
  }

  // ==================== 下单 ====================

  private baseReq(params: CreatePaymentParams, txnSubType = '01'): Record<string, string> {
    return {
      version: VERSION,
      encoding: 'UTF-8',
      signMethod: '01', // RSA-SHA256
      txnType: '01', // 消费
      txnSubType,
      bizType: '000201', // B2C 网关支付（借记卡 / 信用卡 / 云闪付）
      accessType: '0', // 商户直接接入
      merId: this.mchId,
      orderId: params.payOrderNo,
      txnTime: this.txnTime(new Date()),
      txnAmt: this.toCents(params.amount),
      currencyCode: '156',
      orderDesc: params.subject.slice(0, 100),
      reqReserved: params.merchantOrderNo,
      backUrl: params.notifyUrl,
    };
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    this.assertReady();
    switch (params.tradeType) {
      // 扫码：后台交易返回 tn（二维码内容）
      case TradeType.NATIVE: {
        const r = await this.call(this.baseReq(params));
        if (r.respCode !== RESP.SUCCESS) throw new Error(`银联下单失败: ${r.respCode} ${r.respMsg || ''}`);
        return { channelTxnId: r.queryId, payParams: { tradeType: params.tradeType, qrCode: r.tn }, raw: r };
      }
      // 云闪付 App 支付：后台交易返回 tn，业务系统唤起云闪付
      case TradeType.APP: {
        const r = await this.call(this.baseReq(params));
        if (r.respCode !== RESP.SUCCESS) throw new Error(`银联下单失败: ${r.respCode} ${r.respMsg || ''}`);
        return { channelTxnId: r.queryId, payParams: { tradeType: params.tradeType, tn: r.tn }, raw: r };
      }
      // PC / H5：前台跳转，返回自动提交表单
      case TradeType.PC:
      case TradeType.MWEB:
      default: {
        const data = this.sign({
          ...this.baseReq(params),
          channelType: params.tradeType === TradeType.MWEB ? '08' : '07', // 07 PC / 08 手机
          frontUrl: this.frontUrl || params.notifyUrl, // 支付完成后浏览器回跳地址
        });
        const formHtml = this.buildFormHtml(`${this.gateway}/gateway/api/frontTransReq.do`, data);
        return {
          payParams: { tradeType: params.tradeType, formHtml, payUrl: `${this.gateway}/gateway/api/frontTransReq.do` },
          raw: { orderId: params.payOrderNo },
        };
      }
    }
  }

  /** 前台交易需要以表单 POST 到银联网关，返回自动提交页 */
  private buildFormHtml(action: string, data: Record<string, string>): string {
    const inputs = Object.entries(data)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, '&quot;')}"/>`)
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body onload="document.forms[0].submit();"><form action="${action}" method="post">${inputs}</form></body></html>`;
  }

  private txnTime(d: Date): string {
    return (
      `${d.getFullYear()}` +
      `${String(d.getMonth() + 1).padStart(2, '0')}` +
      `${String(d.getDate()).padStart(2, '0')}` +
      `${String(d.getHours()).padStart(2, '0')}` +
      `${String(d.getMinutes()).padStart(2, '0')}` +
      `${String(d.getSeconds()).padStart(2, '0')}`
    );
  }

  private toCents(amount: string): string {
    return String(Math.round(Number(amount) * 100));
  }

  private fromCents(cents?: string): string | undefined {
    if (!cents) return undefined;
    return (Number(cents) / 100).toFixed(2);
  }

  // ==================== 查单 / 关单 ====================

  async queryPayment(params: { payOrderNo: string }): Promise<QueryPaymentResult> {
    const r = await this.call({
      version: VERSION,
      encoding: 'UTF-8',
      signMethod: '01',
      txnType: '00', // 查询交易
      txnSubType: '00',
      bizType: '000000',
      accessType: '0',
      merId: this.mchId,
      orderId: params.payOrderNo,
      txnTime: this.txnTime(new Date()),
    });

    // 银联查询响应：origRespCode 为原交易应答码
    if (r.respCode !== RESP.SUCCESS) {
      return { exist: false, status: 'PAYING', raw: r };
    }
    let status: QueryPaymentResult['status'] = 'PAYING';
    if (r.origRespCode === RESP.SUCCESS) status = 'SUCCESS';
    else if (r.origRespCode === RESP.NO_ORIGINAL || r.origRespCode === RESP.DRAWBACK) status = 'CLOSED';
    return {
      exist: true,
      status,
      channelTxnId: r.queryId,
      amount: this.fromCents(r.origTxnAmt),
      paidAt: status === 'SUCCESS' && r.payTime ? this.parseTime(r.payTime) : undefined,
      raw: r,
    };
  }

  /** 银联无独立关单接口：当日交易用消费撤销（txnType=31），隔日自动转为退货由对账/人工处理 */
  async closePayment(params: { payOrderNo: string }): Promise<void> {
    await this.call({
      version: VERSION,
      encoding: 'UTF-8',
      signMethod: '01',
      txnType: '31', // 消费撤销
      txnSubType: '01',
      bizType: '000201',
      accessType: '0',
      merId: this.mchId,
      orderId: `UNDO${params.payOrderNo}`.slice(0, 40),
      txnTime: this.txnTime(new Date()),
    });
  }

  private parseTime(v: string): Date {
    // YYYYMMDDHHmmss
    const p = (s: number, e: number) => Number(v.slice(s, e));
    return new Date(p(0, 4), p(4, 6) - 1, p(6, 8), p(8, 10), p(10, 12), p(12, 14));
  }

  // ==================== 退款 ====================

  async refund(params: RefundParams): Promise<RefundResult> {
    const r = await this.call({
      version: VERSION,
      encoding: 'UTF-8',
      signMethod: '01',
      txnType: '04', // 退货（支持部分退款，可隔日）
      txnSubType: '00',
      bizType: '000201',
      accessType: '0',
      merId: this.mchId,
      orderId: params.refundNo,
      txnTime: this.txnTime(new Date()),
      txnAmt: this.toCents(params.refundAmount),
      origQryId: params.channelTxnId || '', // 原消费交易 queryId
      backUrl: params.notifyUrl,
    });
    if (r.respCode !== RESP.SUCCESS) {
      return { status: 'FAILED', channelStatus: r.respCode, failReason: `${r.respCode} ${r.respMsg || ''}`, raw: r };
    }
    return { channelRefundId: r.queryId, status: 'SUCCESS', channelStatus: r.respCode, raw: r };
  }

  async queryRefund(params: { refundNo: string }): Promise<QueryRefundResult> {
    const r = await this.call({
      version: VERSION,
      encoding: 'UTF-8',
      signMethod: '01',
      txnType: '00',
      txnSubType: '00',
      bizType: '000000',
      accessType: '0',
      merId: this.mchId,
      orderId: params.refundNo,
      txnTime: this.txnTime(new Date()),
    });
    if (r.respCode !== RESP.SUCCESS || r.origRespCode === RESP.NO_ORIGINAL) {
      return { exist: false, status: 'PROCESSING', raw: r };
    }
    return {
      exist: true,
      channelRefundId: r.queryId,
      status: r.origRespCode === RESP.SUCCESS ? 'SUCCESS' : 'FAILED',
      channelStatus: r.origRespCode,
      amount: this.fromCents(r.origTxnAmt),
      raw: r,
    };
  }

  // ==================== 账单 ====================

  /**
   * 银联对账文件为「对账单 + 结果文件」双文件、定制分隔符格式，且需对账专用证书。
   * 当前版本未实现自动解析，返回空列表由人工核对；接入后在此补充。
   */
  async downloadBill(_params: DownloadBillParams): Promise<BillRow[]> {
    this.logger.warn('[unionpay] 银联对账文件自动下载暂未接入，请通过银联商户平台人工核对');
    return [];
  }

  // ==================== 回调 ====================

  async parseNotify(params: { headers?: Record<string, any>; rawBody?: string; query?: Record<string, any> }): Promise<ParsedNotify> {
    // 银联后台通知为 form 表单（原始报文 + signature）
    const data = Object.fromEntries(new URLSearchParams(params.rawBody || '')) as Record<string, string>;
    if (!this.verify(data)) throw new Error('银联回调验签失败');

    const payOrderNo = data.orderId || '';
    const tradeNo = data.queryId || '';

    // 退货通知：txnType=04
    if (data.txnType === '04') {
      return {
        payOrderNo: data.origOrderId || payOrderNo,
        tradeNo: data.origQueryId || tradeNo,
        status: 'REFUND',
        refundNo: payOrderNo,
        refundStatus: data.respCode === RESP.SUCCESS ? 'SUCCESS' : 'FAILED',
        refundAmount: this.fromCents(data.txnAmt),
        amount: this.fromCents(data.txnAmt),
        raw: data,
      };
    }

    // 撤销通知：txnType=31
    if (data.txnType === '31') {
      return {
        payOrderNo: (data.origOrderId || payOrderNo).replace(/^UNDO/, ''),
        tradeNo: data.origQueryId || tradeNo,
        status: 'CLOSED',
        amount: this.fromCents(data.txnAmt),
        raw: data,
      };
    }

    return {
      payOrderNo,
      tradeNo,
      status: data.respCode === RESP.SUCCESS ? 'SUCCESS' : 'FAILED',
      amount: this.fromCents(data.txnAmt || data.settleAmt),
      paidAt: data.payTime ? this.parseTime(data.payTime) : undefined,
      raw: data,
    };
  }

  /** 银联要求返回 JSON：respCode=00 表示已收到 */
  notifyResponse(success: boolean, message?: string) {
    return {
      body: JSON.stringify(success ? { respCode: RESP.SUCCESS } : { respCode: '01', respMsg: message || 'fail' }),
      contentType: 'application/json',
    };
  }
}
