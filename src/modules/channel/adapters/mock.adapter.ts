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

interface MockRecord {
  payOrderNo: string;
  amount: string;
  channelTxnId: string;
  status: 'PAYING' | 'SUCCESS' | 'CLOSED' | 'FAILED' | 'REFUNDED';
  payerId: string;
  paidAt?: Date;
  refunds: Map<string, { refundNo: string; amount: string; status: 'PROCESSING' | 'SUCCESS' | 'FAILED' }>;
}

/**
 * 本地模拟渠道
 * 用途：
 *  1) 未申请商户号时，完整跑通「下单 -> 支付 -> 回调 -> 通知 -> 对账」全链路
 *  2) 自动化测试
 *  3) 对账演练（可通过 MOCK_INJECT_DIFF_* 人为制造差异）
 * 注意：仅当 DEFAULT_CHANNEL_MODE=sandbox 或渠道配置 isSandbox=true 时可用
 */
export class MockAdapter implements ChannelAdapter {
  readonly channel = Channel.MOCK;
  readonly mchId: string;
  readonly isSandbox = true;
  private readonly logger = new Logger(MockAdapter.name);

  /** 进程内「渠道侧」账本 */
  private static readonly ledger = new Map<string, MockRecord>();
  /** 人为注入的对账差异（用于演练）：outTradeNo -> 处理策略 */
  static readonly injectedDiffs = new Map<string, 'MISSING_IN_CHANNEL' | 'AMOUNT_DIFF' | 'EXTRA_IN_CHANNEL'>();

  constructor(mchId = 'MOCK_MCH_001') {
    this.mchId = mchId;
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const channelTxnId = `MOCKTXN${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
    MockAdapter.ledger.set(params.payOrderNo, {
      payOrderNo: params.payOrderNo,
      amount: params.amount,
      channelTxnId,
      status: 'PAYING',
      payerId: params.payerId || 'mock_openid_001',
      refunds: new Map(),
    });
    this.logger.log(`[MOCK] 下单 ${params.payOrderNo} ${params.amount}元 tradeType=${params.tradeType}`);
    return {
      channelTxnId,
      payParams: {
        // 业务系统可直接跳转到该地址完成「模拟支付」
        mockPayUrl: `${process.env.PAY_BASE_URL || ''}/mock/cashier?pay_order_no=${params.payOrderNo}`,
        tradeType: params.tradeType,
        payOrderNo: params.payOrderNo,
        amount: params.amount,
        expireAt: params.expireAt?.toISOString(),
      },
      raw: { channel: this.channel, channelTxnId },
    };
  }

  async queryPayment(params: { payOrderNo: string }): Promise<QueryPaymentResult> {
    const rec = MockAdapter.ledger.get(params.payOrderNo);
    if (!rec) return { exist: false, status: 'CLOSED' };
    return {
      exist: true,
      status: rec.status as any,
      channelTxnId: rec.channelTxnId,
      payerId: rec.payerId,
      amount: rec.amount,
      paidAt: rec.paidAt,
      raw: rec,
    };
  }

  async closePayment(params: { payOrderNo: string }): Promise<void> {
    const rec = MockAdapter.ledger.get(params.payOrderNo);
    if (rec && rec.status === 'PAYING') rec.status = 'CLOSED';
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const rec = MockAdapter.ledger.get(params.payOrderNo);
    if (!rec || rec.status !== 'SUCCESS') {
      return { status: 'FAILED', failReason: '原订单不存在或未支付成功' };
    }
    const channelRefundId = `MOCKRFD${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
    rec.refunds.set(params.refundNo, {
      refundNo: params.refundNo,
      amount: params.refundAmount,
      status: 'SUCCESS',
    });
    // 模拟全额退款后订单状态变为已退款
    if (Number(params.refundAmount) >= Number(params.payAmount)) rec.status = 'REFUNDED';
    this.logger.log(`[MOCK] 退款成功 ${params.refundNo} ${params.refundAmount}元`);
    return { channelRefundId, status: 'SUCCESS', channelStatus: 'SUCCESS', fundsAccount: 'MOCK' };
  }

  async queryRefund(params: { refundNo: string; payOrderNo?: string }): Promise<QueryRefundResult> {
    for (const rec of MockAdapter.ledger.values()) {
      const r = rec.refunds.get(params.refundNo);
      if (r) {
        return {
          exist: true,
          channelRefundId: `MOCKRFD_${params.refundNo}`,
          status: r.status,
          amount: r.amount,
          refundedAt: new Date(),
        };
      }
    }
    return { exist: false, status: 'PROCESSING' };
  }

  /**
   * 模拟账单：
   *  - 默认直接以「渠道侧账本」为数据源生成（与支付中心一致 => 平账）
   *  - 通过 MockAdapter.injectedDiffs 可人为制造长款/短款/金额差异用于演练
   */
  async downloadBill(params: DownloadBillParams): Promise<BillRow[]> {
    const rows: BillRow[] = [];
    const targetDate = params.billDate.replace(/-/g, '');

    for (const rec of MockAdapter.ledger.values()) {
      if (rec.status !== 'SUCCESS' && rec.status !== 'REFUNDED') continue;
      const tradeDay = (rec.paidAt || new Date()).toISOString().slice(0, 10).replace(/-/g, '');
      if (tradeDay !== targetDate) continue;

      const injected = MockAdapter.injectedDiffs.get(rec.payOrderNo);
      if (injected === 'MISSING_IN_CHANNEL') continue; // 制造短款

      let amount = rec.amount;
      if (injected === 'AMOUNT_DIFF') amount = (Number(rec.amount) + 10).toFixed(2);

      rows.push({
        tradeNo: rec.channelTxnId,
        outTradeNo: rec.payOrderNo,
        amount,
        refundAmount: '0.00',
        tradeStatus: 'SUCCESS',
        rawStatus: 'SUCCESS',
        tradeTime: rec.paidAt || new Date(),
        payerId: rec.payerId,
        subject: '模拟交易',
        tradeType: 'MOCK',
        billType: 'TRADE',
      });
    }

    // 制造长款：渠道多出一笔支付中心没有的单
    for (const [outTradeNo, type] of MockAdapter.injectedDiffs.entries()) {
      if (type !== 'EXTRA_IN_CHANNEL') continue;
      rows.push({
        tradeNo: `MOCKTXN_EXTRA_${outTradeNo}`,
        outTradeNo,
        amount: '99.00',
        refundAmount: '0.00',
        tradeStatus: 'SUCCESS',
        rawStatus: 'SUCCESS',
        tradeTime: new Date(`${params.billDate}T12:00:00`),
        payerId: 'mock_extra_payer',
        subject: '渠道多出的订单',
        tradeType: 'MOCK',
        billType: 'TRADE',
      });
    }
    return rows;
  }

  async parseNotify(params: { rawBody: string }): Promise<ParsedNotify> {
    const body = JSON.parse(params.rawBody || '{}');
    return {
      payOrderNo: body.pay_order_no,
      tradeNo: body.trade_no,
      status: body.status || 'SUCCESS',
      amount: body.amount,
      paidAt: body.paid_at ? new Date(body.paid_at) : new Date(),
      payerId: body.payer_id,
      refundNo: body.refund_no,
      refundStatus: body.refund_status,
      refundAmount: body.refund_amount,
      raw: body,
    };
  }

  notifyResponse(success: boolean, message?: string) {
    return {
      body: JSON.stringify({ code: success ? 'SUCCESS' : 'FAIL', message: message || '' }),
      contentType: 'application/json',
    };
  }

  // ============ 供测试/演练使用的辅助方法 ============

  /** 模拟用户在渠道侧完成支付（会触发真实回调链路） */
  static markPaid(payOrderNo: string, amount?: string): MockRecord | undefined {
    const rec = MockAdapter.ledger.get(payOrderNo);
    if (!rec) return undefined;
    rec.status = 'SUCCESS';
    rec.paidAt = new Date();
    if (amount) rec.amount = amount;
    return rec;
  }

  static get(payOrderNo: string): MockRecord | undefined {
    return MockAdapter.ledger.get(payOrderNo);
  }
}

export interface DownloadBillParamsWithPayOrder extends DownloadBillParams {
  payOrderNo?: string;
}
