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
import { DateUtil } from '../../../common/utils/date.util';

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

  /**
   * @param mchId 渠道商户号
   * @param prisma 可选：传入后账单可跨进程重启从支付中心订单补齐（仅用于本地演练）
   */
  constructor(mchId = 'MOCK_MCH_001', private readonly prisma?: any) {
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
    const emitted = new Set<string>();

    for (const rec of MockAdapter.ledger.values()) {
      if (rec.status !== 'SUCCESS' && rec.status !== 'REFUNDED') continue;
      // 交易日按本地日期口径（与账单日一致），避免 toISOString 的 UTC 偏移导致跨零点错位
      const tradeDay = DateUtil.localDay(rec.paidAt || new Date()).replace(/-/g, '');
      if (tradeDay !== targetDate) continue;

      const injected = MockAdapter.injectedDiffs.get(rec.payOrderNo);
      if (injected === 'MISSING_IN_CHANNEL') continue; // 制造短款

      let amount = rec.amount;
      if (injected === 'AMOUNT_DIFF') amount = (Number(rec.amount) + 10).toFixed(2);

      // 渠道侧已退金额（真实渠道账单交易行也带该列）
      let refunded = 0;
      for (const r of rec.refunds.values()) {
        if (r.status === 'SUCCESS') refunded += Number(r.amount);
      }

      emitted.add(rec.payOrderNo);
      rows.push({
        tradeNo: rec.channelTxnId,
        outTradeNo: rec.payOrderNo,
        amount,
        refundAmount: refunded.toFixed(2),
        tradeStatus: 'SUCCESS',
        rawStatus: 'SUCCESS',
        tradeTime: rec.paidAt || new Date(),
        payerId: rec.payerId,
        subject: '模拟交易',
        tradeType: 'MOCK',
        billType: 'TRADE',
      });
    }

    // 进程内账本会随服务重启丢失：从支付中心订单补齐当日交易，保证演练可重复对账
    await this.appendPersistedOrders(params.billDate, emitted, rows);

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

  /**
   * 账本补齐：渠道账本是进程内的，服务重启后会丢。
   * 本地演练（mock）场景下，用支付中心当日已支付订单补出账单行，保证「渠道=中心」时能对平。
   */
  private async appendPersistedOrders(billDate: string, emitted: Set<string>, rows: BillRow[]): Promise<void> {
    if (!this.prisma?.payOrder) return;
    const { start, end } = DateUtil.localDayRange(billDate);
    let orders: any[];
    try {
      orders = await this.prisma.payOrder.findMany({
        where: {
          channel: Channel.MOCK,
          paidAt: { gte: start, lte: end },
          status: { in: ['SUCCESS', 'REFUNDING', 'REFUNDED'] },
        },
        select: {
          payOrderNo: true,
          amount: true,
          paidAmount: true,
          paidAt: true,
          channelTxnId: true,
          refundedAmount: true,
        },
      });
    } catch (e: any) {
      this.logger.warn(`[MOCK] 账本补齐失败，仅使用进程内账本: ${e.message}`);
      return;
    }

    const missing = orders.filter((o) => !emitted.has(o.payOrderNo));
    if (!missing.length) return;

    let refundSum = new Map<string, number>();
    try {
      const grouped = await this.prisma.refundOrder.groupBy({
        by: ['payOrderNo'],
        where: { status: 'SUCCESS', payOrderNo: { in: missing.map((o) => o.payOrderNo) } },
        _sum: { refundAmount: true },
      });
      refundSum = new Map(grouped.map((g: any) => [g.payOrderNo, Number(g._sum?.refundAmount || 0)]));
    } catch {
      /* 忽略：无退款数据时不影响主流程 */
    }

    for (const o of missing) {
      const amount = Number(o.paidAmount ?? o.amount ?? 0);
      const refunded = o.refundedAmount != null ? Number(o.refundedAmount) : refundSum.get(o.payOrderNo) || 0;
      rows.push({
        tradeNo: o.channelTxnId || `MOCKTXN_${o.payOrderNo}`,
        outTradeNo: o.payOrderNo,
        amount: amount.toFixed(2),
        refundAmount: refunded.toFixed(2),
        tradeStatus: 'SUCCESS',
        rawStatus: 'SUCCESS',
        tradeTime: o.paidAt || new Date(`${billDate}T12:00:00`),
        payerId: 'mock_openid_001',
        subject: '模拟交易',
        tradeType: 'MOCK',
        billType: 'TRADE',
      });
    }
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
