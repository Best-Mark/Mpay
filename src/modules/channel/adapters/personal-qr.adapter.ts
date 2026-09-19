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
import { Channel } from '../../../common/constants/enums';
import { BizException } from '../../../common/exceptions/biz.exception';
import { ErrorCode } from '../../../common/constants/error-codes';

/**
 * 个人收款码渠道适配器
 *
 * 特点（与微信/支付宝等「有商户号」渠道的本质差异）：
 *  1) 没有渠道侧下单/回调接口 —— 付款人扫的是收款方自己的静态收款码，资金不经过支付中心
 *  2) 因此「是否到账」渠道无法告知：由付款人在收银台页点「我已支付」，
 *     再由收款方在后台核对自己的微信/支付宝账单后点「确认到账」
 *  3) 一经确认，订单状态流转与异步通知与正式渠道完全一致 —— 业务系统代码零差异
 *  4) 不支持渠道侧退款 / 渠道账单下载：退款需人工原路退回，对账按人工核对处理
 */
export class PersonalQrAdapter implements ChannelAdapter {
  readonly channel = Channel.PERSONAL_QR;
  readonly mchId: string;
  /** 个人码不接触渠道密钥与真实资金 API，不受沙箱强制代理影响 */
  readonly isSandbox = false;
  private readonly logger = new Logger(PersonalQrAdapter.name);

  constructor(mchId = 'PERSONAL_QR', private readonly prisma?: any) {
    this.mchId = mchId;
  }

  /** 收银台页地址：展示收款码 + 金额 + 「我已支付」按钮 + 状态轮询 */
  static cashierUrl(payOrderNo: string): string {
    const base = (process.env.PAY_BASE_URL || '').replace(/\/$/, '');
    return `${base}/qr/cashier?pay_order_no=${payOrderNo}`;
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    if (!this.prisma?.personalQrCode) {
      throw new BizException(ErrorCode.PARAM_ERROR, '个人收款码渠道未初始化（缺少数据库连接）');
    }
    const codes = await this.prisma.personalQrCode.findMany({
      where: { appId: params.appId, enabled: true },
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
    });
    if (!codes.length) {
      throw new BizException(ErrorCode.PARAM_ERROR, `业务系统 ${params.appId} 未配置个人收款码，请到后台「业务系统 → 收款码」上传`);
    }

    const payUrl = PersonalQrAdapter.cashierUrl(params.payOrderNo);
    const channelTxnId = `QR${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
    this.logger.log(`[personal-qr] 下单 ${params.payOrderNo} ${params.amount}元 appId=${params.appId} 码=${codes.length}张`);

    return {
      channelTxnId,
      payParams: {
        payUrl,
        // 收银台页地址（相对路径）：PAY_BASE_URL 未配置时业务系统可自行拼接 baseUrl
        cashierPath: `/qr/cashier?pay_order_no=${params.payOrderNo}`,
        /** 收款码集合：业务系统若想自己渲染收银台可直接用 */
        codes: codes.map((c: any) => ({ type: c.type, name: c.name, imageUrl: c.imageUrl })),
        amount: params.amount,
        payOrderNo: params.payOrderNo,
        subject: params.subject,
        expireAt: params.expireAt?.toISOString(),
        /** 付款备注建议：让付款人填这个尾号，便于收款方核对账单 */
        payRemark: params.payOrderNo.slice(-6),
      },
      payInfo: { type: 'redirect', url: payUrl },
      raw: { channel: this.channel, channelTxnId, codeCount: codes.length },
    };
  }

  /**
   * 查单：渠道侧无订单，一律返回 PAYING（不改变支付中心订单状态）
   * 避免 syncFromChannel 把「等待人工确认」的订单误判为失败/关闭
   */
  async queryPayment(params: { payOrderNo: string }): Promise<QueryPaymentResult> {
    return { exist: true, status: 'PAYING', raw: { channel: this.channel, payOrderNo: params.payOrderNo } };
  }

  async closePayment(_params: { payOrderNo: string }): Promise<void> {
    // 静态收款码无渠道侧订单可关，关单只发生在支付中心内部
  }

  async refund(_params: RefundParams): Promise<RefundResult> {
    return {
      status: 'FAILED',
      failReason: '个人收款码渠道不支持自动退款，请收款方在微信/支付宝账单中人工原路退回',
    };
  }

  async queryRefund(_params: { refundNo: string; payOrderNo?: string }): Promise<QueryRefundResult> {
    return { exist: false, status: 'FAILED', failReason: '个人收款码渠道无渠道侧退款单' };
  }

  /** 无渠道账单：对账以「人工核对」为准，返回空账单避免制造虚假差异 */
  async downloadBill(_params: DownloadBillParams): Promise<BillRow[]> {
    return [];
  }

  async parseNotify(_params: { rawBody: string }): Promise<ParsedNotify> {
    throw new BizException(ErrorCode.PARAM_ERROR, '个人收款码渠道没有渠道回调，到账由后台人工确认');
  }

  notifyResponse(success: boolean, message?: string) {
    return {
      body: JSON.stringify({ code: success ? 'SUCCESS' : 'FAIL', message: message || '' }),
      contentType: 'application/json',
    };
  }
}
