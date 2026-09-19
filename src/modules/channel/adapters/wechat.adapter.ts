import axios from 'axios';
import * as crypto from 'crypto';
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

const WECHAT_HOST = 'https://api.mch.weixin.qq.com';

/** 微信交易状态 -> 归一化状态 */
const WECHAT_TRADE_STATUS_MAP: Record<string, BillRow['tradeStatus']> = {
  SUCCESS: 'SUCCESS',
  '支付成功': 'SUCCESS',
  REFUND: 'REFUND',
  '转入退款': 'REFUND',
  NOTPAY: 'PAYING',
  '未支付': 'PAYING',
  CLOSED: 'CLOSED',
  '已关闭': 'CLOSED',
  REVOKED: 'REVOKED',
  '已撤销': 'REVOKED',
  PAYERROR: 'FAILED',
  '支付失败': 'FAILED',
};

/**
 * 微信支付 V3 适配器
 * 依赖配置：mchId、channelAppId(appid)、certSerialNo、apiV3Key、privateKey(PEM)、platformCert(PEM)
 */
export class WechatAdapter implements ChannelAdapter {
  readonly channel = Channel.WECHAT;
  readonly mchId: string;
  readonly isSandbox: boolean;
  private readonly logger = new Logger(WechatAdapter.name);

  private readonly appid: string;
  private readonly serialNo: string;
  private readonly apiV3Key: string;
  private readonly privateKey: string;
  private readonly platformCert: string;

  constructor(config: {
    mchId: string;
    appid?: string;
    serialNo?: string;
    apiV3Key?: string;
    privateKey?: string;
    platformCert?: string;
    isSandbox?: boolean;
  }) {
    this.mchId = config.mchId;
    this.appid = config.appid || '';
    this.serialNo = config.serialNo || '';
    this.apiV3Key = config.apiV3Key || '';
    this.privateKey = config.privateKey || '';
    this.platformCert = config.platformCert || '';
    this.isSandbox = !!config.isSandbox;
  }

  private assertReady() {
    if (!this.privateKey || !this.serialNo || !this.mchId) {
      throw new Error('微信支付配置不完整：缺少 mchId / serialNo / privateKey');
    }
  }

  // ==================== HTTP 签名 ====================

  private buildAuthorization(method: string, urlPath: string, timestamp: number, nonce: string, body: string): string {
    const content = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = CryptoUtil.rsaSign(content, this.privateKey);
    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.serialNo}"`;
  }

  private async request<T = any>(
    method: 'GET' | 'POST',
    urlPath: string,
    body?: any,
    opts: { absoluteUrl?: string; rawText?: boolean } = {},
  ): Promise<T> {
    this.assertReady();
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = CryptoUtil.randomString(32);
    const bodyStr = body ? JSON.stringify(body) : '';
    const auth = this.buildAuthorization(method, urlPath, timestamp, nonce, bodyStr);
    const url = opts.absoluteUrl || `${WECHAT_HOST}${urlPath}`;

    try {
      const resp = await axios.request({
        method,
        url,
        data: bodyStr || undefined,
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: opts.rawText ? '*/*' : 'application/json',
          'User-Agent': 'pay-center/1.0',
        },
        timeout: 15000,
        responseType: opts.rawText ? 'text' : 'json',
        transformResponse: opts.rawText ? [(d) => d] : undefined,
      } as any);
      return resp.data;
    } catch (e: any) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      this.logger.error(`[wechat] ${method} ${urlPath} 失败: ${detail}`);
      throw new Error(`微信支付请求失败: ${detail}`);
    }
  }

  /** 校验应答/回调签名 */
  private verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
    if (!this.platformCert) {
      this.logger.warn('[wechat] 未配置平台证书，跳过验签（生产环境必须配置！）');
      return true;
    }
    const content = `${timestamp}\n${nonce}\n${body}\n`;
    return CryptoUtil.rsaVerify(content, signature, this.platformCert);
  }

  // ==================== 下单 ====================

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const amountFen = Money.toFen(params.amount);
    const commonBody: any = {
      mchid: this.mchId,
      appid: this.appid,
      out_trade_no: params.payOrderNo,
      description: params.subject.slice(0, 127),
      attach: params.attach,
      notify_url: params.notifyUrl,
      amount: { total: amountFen, currency: 'CNY' },
      time_expire: params.expireAt ? this.formatRfc3339(params.expireAt) : undefined,
      scene_info: params.tradeType === TradeType.MWEB ? { payer_client_ip: params.clientIp, h5_info: { type: 'Wap' } } : undefined,
    };

    let path = '';
    switch (params.tradeType) {
      case TradeType.JSAPI:
        path = '/v3/pay/transactions/jsapi';
        commonBody.payer = { openid: params.payerId };
        break;
      case TradeType.NATIVE:
        path = '/v3/pay/transactions/native';
        break;
      case TradeType.APP:
        path = '/v3/pay/transactions/app';
        break;
      case TradeType.MWEB:
        path = '/v3/pay/transactions/h5';
        break;
      default:
        throw new Error(`微信支付不支持的交易类型: ${params.tradeType}`);
    }

    const resp = await this.request<any>('POST', path, commonBody);

    // 组装唤起支付参数
    const payParams: Record<string, any> = { tradeType: params.tradeType };
    if (resp.prepay_id) {
      payParams.prepayId = resp.prepay_id;
      const timeStamp = String(Math.floor(Date.now() / 1000));
      const nonceStr = CryptoUtil.randomString(32);
      const pkg = `prepay_id=${resp.prepay_id}`;
      const content = `${this.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
      payParams.appId = this.appid;
      payParams.timeStamp = timeStamp;
      payParams.nonceStr = nonceStr;
      payParams.package = pkg;
      payParams.signType = 'RSA';
      payParams.paySign = CryptoUtil.rsaSign(content, this.privateKey);
    }
    if (resp.code_url) payParams.codeUrl = resp.code_url;
    if (resp.h5_url) payParams.h5Url = resp.h5_url;

    return { channelTxnId: resp.prepay_id ? undefined : resp.transaction_id, payParams, raw: resp };
  }

  private formatRfc3339(d: Date): string {
    return new Date(d).toISOString().replace(/\.\d{3}Z$/, '+08:00');
  }

  // ==================== 查单 / 关单 ====================

  async queryPayment(params: { payOrderNo: string }): Promise<QueryPaymentResult> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(params.payOrderNo)}?mchid=${this.mchId}`;
    try {
      const r = await this.request<any>('GET', path);
      return {
        exist: true,
        status: WECHAT_TRADE_STATUS_MAP[r.trade_state] || 'PAYING',
        channelTxnId: r.transaction_id,
        payerId: r.payer?.openid,
        amount: r.amount?.total ? Money.fromFen(r.amount.total).toString() : undefined,
        paidAt: r.success_time ? new Date(r.success_time.replace('T', ' ').replace('+08:00', '')) : undefined,
        raw: r,
      };
    } catch (e: any) {
      if (/ORDER_NOT_EXIST|ORDERNOTEXIST|404/.test(e.message)) {
        return { exist: false, status: 'CLOSED' };
      }
      throw e;
    }
  }

  async closePayment(params: { payOrderNo: string }): Promise<void> {
    await this.request('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(params.payOrderNo)}/close`, {
      mchid: this.mchId,
    });
  }

  // ==================== 退款 ====================

  async refund(params: RefundParams): Promise<RefundResult> {
    const body = {
      out_trade_no: params.payOrderNo,
      out_refund_no: params.refundNo,
      reason: params.reason,
      notify_url: params.notifyUrl,
      amount: {
        refund: Money.toFen(params.refundAmount),
        total: Money.toFen(params.payAmount),
        currency: 'CNY',
      },
    };
    const r = await this.request<any>('POST', '/v3/refund/domestic/refunds', body);
    const status = this.mapRefundStatus(r.status);
    return {
      channelRefundId: r.refund_id,
      status,
      channelStatus: r.status,
      fundsAccount: r.funds_account,
      raw: r,
    };
  }

  private mapRefundStatus(s?: string): RefundResult['status'] {
    switch (s) {
      case 'SUCCESS':
        return 'SUCCESS';
      case 'CLOSED':
        return 'CLOSED';
      case 'ABNORMAL':
        return 'FAILED';
      default:
        return 'PROCESSING';
    }
  }

  async queryRefund(params: { refundNo: string }): Promise<QueryRefundResult> {
    const path = `/v3/refund/domestic/refunds/out-refund-no/${encodeURIComponent(params.refundNo)}?mchid=${this.mchId}`;
    try {
      const r = await this.request<any>('GET', path);
      return {
        exist: true,
        channelRefundId: r.refund_id,
        status: this.mapRefundStatus(r.status),
        channelStatus: r.status,
        amount: r.amount?.refund ? Money.fromFen(r.amount.refund).toString() : undefined,
        refundedAt: r.success_time ? new Date(r.success_time) : undefined,
        raw: r,
      };
    } catch (e: any) {
      if (/NOT_EXIST|404/.test(e.message)) return { exist: false, status: 'PROCESSING' };
      throw e;
    }
  }

  // ==================== 账单 ====================

  async downloadBill(params: DownloadBillParams): Promise<BillRow[]> {
    const billType = (params.billType || 'ALL') === 'REFUND' ? 'REFUND' : 'ALL';
    const path = `/v3/bill/tradebill?bill_date=${params.billDate}&bill_type=${billType}&tar_type=GZIP`;
    const meta = await this.request<any>('GET', path);
    if (!meta.download_url) throw new Error('微信账单下载链接为空');

    const csv = await this.request<string>('GET', '', undefined, {
      absoluteUrl: meta.download_url,
      rawText: true,
    });
    const text = this.maybeGunzip(csv);
    return this.parseBillCsv(text, params.billDate);
  }

  private maybeGunzip(data: any): string {
    if (typeof data !== 'string') {
      try {
        return require('zlib').gunzipSync(Buffer.from(data)).toString('utf8');
      } catch {
        return Buffer.from(data).toString('utf8');
      }
    }
    // 若 axios 未解压，尝试判断是否为 gzip 二进制（已被转成 latin1 字符串）
    return data;
  }

  /**
   * 解析微信账单 CSV
   * 结构：第 1 行中文表头；中间数据行；末尾若干统计行（以「总交易单数」开头）
   * 采用「按表头名动态取列索引」的解析方式，兼容微信不同版本表头顺序变化
   */
  parseBillCsv(text: string, billDate: string): BillRow[] {
    const clean = text.replace(/^\uFEFF/, '').trim();
    if (!clean) return [];
    const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return [];

    const header = this.splitCsvLine(lines[0]).map((s) => s.replace(/^`/, '').trim());
    const idx = (name: string) => header.indexOf(name);

    const iTradeTime = idx('交易时间');
    const iTxnId = idx('微信订单号');
    const iOutTradeNo = idx('商户订单号');
    const iPayer = idx('用户标识');
    const iTradeType = idx('交易类型');
    const iStatus = idx('交易状态');
    const iTotal = idx('订单金额');
    const iSettle = idx('应结订单金额');
    const iRefund = idx('退款金额');
    const iMerchantRefundNo = idx('商户退款单号');
    const iSubject = idx('商品名称');
    const iFee = idx('手续费');

    const rows: BillRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // 统计行以 ` 开头且包含「总交易单数」
      if (line.startsWith('`') || line.includes('总交易单数') || line.includes('总退款金额')) continue;
      const cols = this.splitCsvLine(line);
      const outTradeNo = (cols[iOutTradeNo] || '').replace(/^`/, '').trim();
      if (!outTradeNo) continue;

      // 优先取「订单金额」（用户实际应付，与支付中心订单金额一致）；
      // 无该列时退回「应结订单金额」（注意：使用代金券时二者不等，会在对账中体现为金额差异，由人工核实）
      const amount = (iTotal >= 0 ? cols[iTotal] : iSettle >= 0 ? cols[iSettle] : cols[iTotal]) || '0';
      const refundAmount = iRefund >= 0 ? cols[iRefund] || '0' : '0';
      const rawStatus = (cols[iStatus] || '').replace(/^`/, '').trim();

      rows.push({
        tradeNo: (cols[iTxnId] || '').replace(/^`/, '').trim(),
        outTradeNo,
        amount: this.normalAmount(amount),
        refundAmount: this.normalAmount(refundAmount),
        tradeStatus: WECHAT_TRADE_STATUS_MAP[rawStatus] || 'SUCCESS',
        rawStatus,
        tradeTime: this.parseTradeTime(cols[iTradeTime], billDate),
        payerId: (cols[iPayer] || '').replace(/^`/, '').trim(),
        subject: cols[iSubject],
        tradeType: cols[iTradeType],
        fee: iFee >= 0 ? this.normalAmount(cols[iFee]) : undefined,
        billType: 'TRADE',
        refundNo: iMerchantRefundNo >= 0 ? (cols[iMerchantRefundNo] || '').replace(/^`/, '').trim() : undefined,
      });
    }
    return rows;
  }

  /** CSV 行分割（微信账单字段本身不含引号包裹的逗号，直接 split 即可） */
  private splitCsvLine(line: string): string[] {
    return line.split(',');
  }

  private normalAmount(v: string): string {
    if (!v) return '0.00';
    const n = Number(String(v).replace(/[^\d.\-]/g, ''));
    if (!Number.isFinite(n)) return '0.00';
    return Money.round(n, 2).toString();
  }

  private parseTradeTime(v: string, billDate: string): Date {
    if (!v) return new Date(`${billDate}T00:00:00`);
    const t = v.replace(/^`/, '').trim(); // 2026-09-18 12:00:00
    const d = new Date(t.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? new Date(`${billDate}T00:00:00`) : d;
  }

  // ==================== 回调 ====================

  async parseNotify(params: { headers: Record<string, any>; rawBody: string }): Promise<ParsedNotify> {
    const h = params.headers || {};
    const timestamp = String(h['wechatpay-timestamp'] || '');
    const nonce = String(h['wechatpay-nonce'] || '');
    const signature = String(h['wechatpay-signature'] || '');
    const body = params.rawBody;

    const ok = this.verifySignature(timestamp, nonce, body, signature);
    if (!ok) throw new Error('微信回调验签失败');

    const payload = JSON.parse(body);
    const resource = payload.resource || {};
    let decrypted: any = {};
    if (resource.ciphertext) {
      decrypted = JSON.parse(
        CryptoUtil.aesGcmDecrypt(this.apiV3Key, resource.nonce, resource.associated_data, resource.ciphertext),
      );
    }

    const eventType = payload.event_type || '';
    const isRefund = eventType.startsWith('REFUND');

    if (isRefund) {
      return {
        payOrderNo: decrypted.out_trade_no,
        tradeNo: decrypted.transaction_id || '',
        status: 'REFUND',
        amount: decrypted.amount?.total ? Money.fromFen(decrypted.amount.total).toString() : undefined,
        paidAt: decrypted.success_time ? new Date(decrypted.success_time) : undefined,
        refundNo: decrypted.out_refund_no,
        refundStatus: this.mapRefundNotifyStatus(decrypted.refund_status),
        refundAmount: decrypted.amount?.refund ? Money.fromFen(decrypted.amount.refund).toString() : undefined,
        raw: decrypted,
      };
    }

    return {
      payOrderNo: decrypted.out_trade_no,
      tradeNo: decrypted.transaction_id,
      status: WECHAT_TRADE_STATUS_MAP[decrypted.trade_state] || 'PAYING',
      amount: decrypted.amount?.total ? Money.fromFen(decrypted.amount.total).toString() : undefined,
      paidAt: decrypted.success_time ? new Date(decrypted.success_time) : undefined,
      payerId: decrypted.payer?.openid,
      raw: decrypted,
    };
  }

  private mapRefundNotifyStatus(s?: string): ParsedNotify['refundStatus'] {
    switch (s) {
      case 'SUCCESS':
        return 'SUCCESS';
      case 'ABNORMAL':
      case 'FAILED':
        return 'FAILED';
      case 'CLOSED':
        return 'CLOSED';
      default:
        return 'PROCESSING';
    }
  }

  notifyResponse(success: boolean, message?: string) {
    return {
      body: JSON.stringify(success ? { code: 'SUCCESS', message: '成功' } : { code: 'FAIL', message: message || '失败' }),
      contentType: 'application/json',
    };
  }
}

/** 生成随机串（对外保留，便于 SDK 复用） */
export function wechatNonce(len = 32): string {
  return crypto.randomBytes(len / 2).toString('hex');
}
