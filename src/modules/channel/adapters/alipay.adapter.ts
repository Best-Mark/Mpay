import axios from 'axios';
import * as qs from 'querystring';
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
import { CryptoUtil } from '../../../common/utils/crypto.util';
import { Money } from '../../../common/utils/money';

const ALIPAY_GATEWAY = process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';

/** 支付宝交易状态 -> 归一化 */
const ALIPAY_STATUS_MAP: Record<string, BillRow['tradeStatus']> = {
  TRADE_SUCCESS: 'SUCCESS',
  TRADE_FINISHED: 'SUCCESS',
  '交易成功': 'SUCCESS',
  '交易完成': 'SUCCESS',
  TRADE_CLOSED: 'CLOSED',
  '交易关闭': 'CLOSED',
  '交易取消': 'CLOSED',
  WAIT_BUYER_PAY: 'PAYING',
  '等待付款': 'PAYING',
  '等待买家付款': 'PAYING',
  TRADE_REFUND: 'REFUND',
  '退款成功': 'REFUND',
};

/**
 * 支付宝适配器（开放平台 2.0，RSA2 签名）
 * 依赖配置：channelAppId(appid)、privateKey(PEM PKCS8)、platformCert(支付宝公钥 PEM)
 */
export class AlipayAdapter implements ChannelAdapter {
  readonly channel = Channel.ALIPAY;
  readonly mchId: string;
  readonly isSandbox: boolean;
  private readonly logger = new Logger(AlipayAdapter.name);

  private readonly appId: string;
  private readonly privateKey: string;
  private readonly alipayPublicKey: string;

  constructor(config: {
    mchId: string;
    appid?: string;
    privateKey?: string;
    platformCert?: string;
    isSandbox?: boolean;
  }) {
    this.mchId = config.mchId || config.appid || '';
    this.appId = config.appid || '';
    this.privateKey = config.privateKey || '';
    this.alipayPublicKey = config.platformCert || '';
    this.isSandbox = !!config.isSandbox;
  }

  private assertReady() {
    if (!this.appId || !this.privateKey) {
      throw new Error('支付宝配置不完整：缺少 appid / privateKey');
    }
  }

  // ==================== 网关调用 ====================

  private signParams(params: Record<string, any>): Record<string, any> {
    const content = CryptoUtil.buildSignContent(params);
    return { ...params, sign: CryptoUtil.rsaSign(content, this.privateKey) };
  }

  private async call<T = any>(method: string, bizContent: Record<string, any>): Promise<T> {
    this.assertReady();
    const common: Record<string, any> = {
      app_id: this.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.now(),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
    };
    const signed = this.signParams(common);

    const resp = await axios.post(ALIPAY_GATEWAY, qs.stringify(signed), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      timeout: 15000,
      responseType: 'text',
    });

    const raw = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    const parsed = JSON.parse(raw);
    const nodeKey = `${method.replace(/\./g, '_')}_response`;
    const node = parsed[nodeKey];
    if (!node) throw new Error(`支付宝返回异常: ${raw.slice(0, 500)}`);

    // 验签（生产必须配置支付宝公钥）
    if (this.alipayPublicKey && parsed.sign) {
      const ok = CryptoUtil.rsaVerify(
        CryptoUtil.buildSignContent(node) === '' ? JSON.stringify(node) : JSON.stringify(node),
        parsed.sign,
        this.alipayPublicKey,
      );
      if (!ok) this.logger.warn('[alipay] 应答验签未通过，请检查支付宝公钥配置');
    }

    if (node.code !== '10000') {
      this.logger.error(`[alipay] ${method} 业务失败: ${node.sub_code} ${node.sub_msg}`);
      return node; // 交由上层按 sub_code 判断
    }
    return node;
  }

  private now(): string {
    // 支付宝要求 yyyy-MM-dd HH:mm:ss，按东八区
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  }

  /** 页面类接口：构造跳转 URL（PC 网站支付 / 手机网站支付） */
  private buildPageUrl(method: string, bizContent: Record<string, any>): string {
    const common: Record<string, any> = {
      app_id: this.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.now(),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
    };
    const signed = this.signParams(common);
    return `${ALIPAY_GATEWAY}?${qs.stringify(signed)}`;
  }

  // ==================== 下单 ====================

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const base: any = {
      out_trade_no: params.payOrderNo,
      total_amount: Money.format(params.amount),
      subject: params.subject.slice(0, 128),
      body: params.body,
      product_code: this.productCode(params.tradeType),
      timeout_express: params.expireAt ? this.timeoutExpress(params.expireAt) : '30m',
    };

    switch (params.tradeType) {
      case TradeType.PC: {
        const url = this.buildPageUrl('alipay.trade.page.pay', {
          ...base,
          product_code: 'FAST_INSTANT_TRADE_PAY',
        });
        return { payParams: { tradeType: params.tradeType, payUrl: url }, raw: { url } };
      }
      case TradeType.MWEB: {
        const url = this.buildPageUrl('alipay.trade.wap.pay', {
          ...base,
          product_code: 'QUICK_WAP_WAY',
        });
        return { payParams: { tradeType: params.tradeType, payUrl: url }, raw: { url } };
      }
      case TradeType.NATIVE: {
        const r = await this.call<any>('alipay.trade.precreate', {
          ...base,
          notify_url: params.notifyUrl,
        });
        return {
          channelTxnId: r.trade_no,
          payParams: { tradeType: params.tradeType, qrCode: r.qr_code, outTradeNo: r.out_trade_no },
          raw: r,
        };
      }
      case TradeType.FACE_TO_FACE: {
        const r = await this.call<any>('alipay.trade.pay', {
          ...base,
          scene: 'bar_code',
          auth_code: params.payerId,
          notify_url: params.notifyUrl,
        });
        return { channelTxnId: r.trade_no, payParams: { tradeType: params.tradeType, tradeNo: r.trade_no }, raw: r };
      }
      case TradeType.APP:
      case TradeType.JSAPI:
      default: {
        const r = await this.call<any>('alipay.trade.create', {
          ...base,
          buyer_id: params.payerId,
          notify_url: params.notifyUrl,
        });
        return {
          channelTxnId: r.trade_no,
          payParams: { tradeType: params.tradeType, tradeNo: r.trade_no, outTradeNo: r.out_trade_no },
          raw: r,
        };
      }
    }
  }

  private productCode(t: TradeType): string {
    switch (t) {
      case TradeType.PC:
        return 'FAST_INSTANT_TRADE_PAY';
      case TradeType.MWEB:
        return 'QUICK_WAP_WAY';
      case TradeType.NATIVE:
        return 'FACE_TO_FACE_PAYMENT';
      default:
        return 'JSAPI_PAY';
    }
  }

  private timeoutExpress(expireAt: Date): string {
    const minutes = Math.max(1, Math.round((expireAt.getTime() - Date.now()) / 60000));
    return `${minutes}m`;
  }

  // ==================== 查单 / 关单 ====================

  async queryPayment(params: { payOrderNo: string }): Promise<QueryPaymentResult> {
    const r = await this.call<any>('alipay.trade.query', {
      out_trade_no: params.payOrderNo,
      query_options: ['TRADE_QUERY'],
    });
    if (r.sub_code === 'ACQ.TRADE_NOT_EXIST') return { exist: false, status: 'CLOSED' };
    return {
      exist: true,
      status: ALIPAY_STATUS_MAP[r.trade_status] || 'PAYING',
      channelTxnId: r.trade_no,
      payerId: r.buyer_user_id,
      amount: r.total_amount,
      paidAt: r.send_pay_date ? new Date(r.send_pay_date) : undefined,
      raw: r,
    };
  }

  async closePayment(params: { payOrderNo: string }): Promise<void> {
    await this.call('alipay.trade.close', { out_trade_no: params.payOrderNo });
  }

  // ==================== 退款 ====================

  async refund(params: RefundParams): Promise<RefundResult> {
    const r = await this.call<any>('alipay.trade.refund', {
      out_trade_no: params.payOrderNo,
      trade_no: params.channelTxnId,
      out_request_no: params.refundNo,
      refund_amount: Money.format(params.refundAmount),
      refund_reason: params.reason,
    });
    if (r.code !== '10000') {
      return {
        status: 'FAILED',
        channelStatus: r.sub_code,
        failReason: `${r.sub_code}:${r.sub_msg}`,
        raw: r,
      };
    }
    return {
      channelRefundId: r.trade_no,
      status: r.fund_change === 'Y' ? 'SUCCESS' : 'PROCESSING',
      channelStatus: r.fund_change,
      fundsAccount: r.refund_huabei_detail ? 'HUABEI' : undefined,
      raw: r,
    };
  }

  async queryRefund(params: { refundNo: string; payOrderNo?: string }): Promise<QueryRefundResult> {
    const r = await this.call<any>('alipay.trade.fastpay.refund.query', {
      out_trade_no: params.payOrderNo || '',
      out_request_no: params.refundNo,
      query_options: ['REFUND_QUERY'],
    });
    if (r.sub_code === 'ACQ.TRADE_NOT_EXIST') return { exist: false, status: 'PROCESSING' };
    return {
      exist: true,
      channelRefundId: r.trade_no,
      status: r.refund_status === 'REFUND_SUCCESS' ? 'SUCCESS' : 'PROCESSING',
      channelStatus: r.refund_status,
      amount: r.refund_amount,
      refundedAt: r.gmt_refund_pay ? new Date(r.gmt_refund_pay) : undefined,
      raw: r,
    };
  }

  // ==================== 账单 ====================

  async downloadBill(params: DownloadBillParams): Promise<BillRow[]> {
    const billType = params.billType === 'REFUND' ? 'signcustomer' : 'trade';
    const r = await this.call<any>('alipay.data.dataservice.bill.downloadurl.query', {
      bill_type: billType,
      bill_date: params.billDate,
    });
    const url = r.bill_download_url;
    if (!url) throw new Error('支付宝账单下载地址为空');

    const resp = await axios.get(url, { timeout: 60000, responseType: 'arraybuffer' });
    const text = this.decode(resp.data);
    return this.parseBillCsv(text, params.billDate);
  }

  private decode(data: any): string {
    const zlib = require('zlib');
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    // 尝试 zip / gzip 解压
    try {
      if (buf[0] === 0x50 && buf[1] === 0x4b) {
        // ZIP：借助 Node 内置无法直接解压，优先尝试 gzip
        throw new Error('zip');
      }
      buf = zlib.gunzipSync(buf);
    } catch {
      /* 非 gzip，按纯文本处理 */
    }
    return buf.toString('utf8');
  }

  /**
   * 解析支付宝账单 CSV：
   * - 以 # 开头的行是注释；表头行可能是 # 开头或普通行
   * - 结尾有统计行（以 # 或「合计」开头）
   * 采用「按列名动态匹配索引」以兼容不同版本表头
   */
  parseBillCsv(text: string, billDate: string): BillRow[] {
    const clean = text.replace(/^\uFEFF/, '').trim();
    const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return [];

    // 找到表头行：第一个不含「合计/总计」且包含「交易号」或「商家订单号」的行
    let headerIndex = -1;
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const l = lines[i];
      if (l.includes('交易号') || l.includes('商家订单号') || l.includes('商户订单号')) {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex < 0) throw new Error('支付宝账单表头无法识别');

    const header = lines[headerIndex]
      .replace(/^#/, '')
      .split(',')
      .map((s) => s.trim());

    const find = (names: string[]): number => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      // 模糊匹配
      for (let i = 0; i < header.length; i++) {
        if (names.some((n) => header[i].includes(n))) return i;
      }
      return -1;
    };

    const iTradeNo = find(['交易号', '支付宝交易号', '交易订单号']);
    const iOutTradeNo = find(['商家订单号', '商户订单号', '商家订单']);
    const iAmount = find(['交易金额', '金额（元）', '订单金额', '金额']);
    const iRealAmount = find(['商家实收', '实收金额']);
    const iStatus = find(['交易状态']);
    const iRefund = find(['成功退款金额', '成功退款（元）', '退款金额']);
    const iPayTime = find(['付款时间', '交易时间']);
    const iSubject = find(['商品名称', '商品说明']);
    const iPayer = find(['付款方', '买家']);

    const rows: BillRow[] = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.includes('合计') || line.includes('总计')) continue;
      const cols = line.split(',').map((s) => s.trim());
      const outTradeNo = iOutTradeNo >= 0 ? cols[iOutTradeNo] : '';
      const tradeNo = iTradeNo >= 0 ? cols[iTradeNo] : '';
      if (!outTradeNo && !tradeNo) continue;

      const amount = iRealAmount >= 0 && cols[iRealAmount] ? cols[iRealAmount] : iAmount >= 0 ? cols[iAmount] : '0';
      const rawStatus = iStatus >= 0 ? cols[iStatus] : '';

      rows.push({
        tradeNo,
        outTradeNo,
        amount: this.normalAmount(amount),
        refundAmount: this.normalAmount(iRefund >= 0 ? cols[iRefund] : '0'),
        tradeStatus: ALIPAY_STATUS_MAP[rawStatus] || 'SUCCESS',
        rawStatus,
        tradeTime: this.parseTime(iPayTime >= 0 ? cols[iPayTime] : '', billDate),
        payerId: iPayer >= 0 ? cols[iPayer] : undefined,
        subject: iSubject >= 0 ? cols[iSubject] : undefined,
        billType: 'TRADE',
      });
    }
    return rows;
  }

  private normalAmount(v: string): string {
    if (!v) return '0.00';
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? Money.round(n, 2).toString() : '0.00';
  }

  private parseTime(v: string, billDate: string): Date {
    if (!v) return new Date(`${billDate}T00:00:00`);
    const d = new Date(v.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? new Date(`${billDate}T00:00:00`) : d;
  }

  // ==================== 回调 ====================

  async parseNotify(params: {
    headers?: Record<string, any>;
    rawBody?: string;
    query?: Record<string, any>;
  }): Promise<ParsedNotify> {
    const body = params.rawBody || '';
    // 支付宝回调为 application/x-www-form-urlencoded
    const data: Record<string, string> = qs.parse(body) as any;
    const sign = data.sign || '';
    if (!sign) throw new Error('支付宝回调缺少签名');

    if (this.alipayPublicKey) {
      const content = CryptoUtil.buildSignContent(data);
      const ok = CryptoUtil.rsaVerify(content, sign, this.alipayPublicKey);
      if (!ok) throw new Error('支付宝回调验签失败');
    } else {
      this.logger.warn('[alipay] 未配置支付宝公钥，跳过回调验签（生产必须配置！）');
    }

    const tradeStatus = data.trade_status || '';
    const outTradeNo = data.out_trade_no;
    const tradeNo = data.trade_no || '';

    // 退款回调：存在 refund_fee 且 trade_status 含 REFUND
    if (data.out_request_no || tradeStatus.includes('REFUND')) {
      return {
        payOrderNo: outTradeNo,
        tradeNo,
        status: 'REFUND',
        amount: data.total_amount,
        refundNo: data.out_request_no,
        refundStatus: tradeStatus === 'REFUND_SUCCESS' ? 'SUCCESS' : 'PROCESSING',
        refundAmount: data.refund_fee,
        raw: data,
      };
    }

    let status: ParsedNotify['status'] = 'PAYING';
    if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') status = 'SUCCESS';
    else if (tradeStatus === 'TRADE_CLOSED') status = 'CLOSED';

    return {
      payOrderNo: outTradeNo,
      tradeNo,
      status,
      amount: data.total_amount || data.receipt_amount,
      paidAt: data.gmt_payment ? new Date(data.gmt_payment) : undefined,
      payerId: data.buyer_id || data.buyer_open_id,
      raw: data,
    };
  }

  notifyResponse(success: boolean, _message?: string) {
    return { body: success ? 'success' : 'fail', contentType: 'text/plain' };
  }
}
