import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MerchantService } from '../merchant/merchant.service';
import { ChannelService } from '../channel/channel.service';
import { NotifyService, buildPayNotifyPayload } from '../notify/notify.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { OrderNoUtil } from '../../common/utils/order-no';
import { Money } from '../../common/utils/money';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { BizException, assertParam, assert } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { Channel, CHANNEL_AUTO, NotifyBizType, PayOrderStatus, TradeType } from '../../common/constants/enums';
import { normalizePayInfo, PayInfo } from '../channel/channel.types';
import { OpenApiOrderView } from './openapi-contract';
import { CreateOrderDto, QueryOrderDto } from './payment.dto';

/** 超过该分钟数仍处于非终态的订单，主动向渠道查单补偿（防止回调丢失） */
const PAYING_QUERY_DELAY_MINUTES = 5;

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantService: MerchantService,
    private readonly channelService: ChannelService,
    private readonly notifyService: NotifyService,
    private readonly opLog: OperationLogService,
  ) {}

  // ==================== 统一下单 ====================

  async createOrder(appId: string, dto: CreateOrderDto, clientIp?: string) {
    const app = await this.merchantService.getSecret(appId);

    // 1. 参数校验
    assertParam(Money.isValid(dto.amount), '订单金额不合法：必须为正数且最多两位小数');
    assertParam(!!dto.merchantOrderNo && !!dto.subject, 'merchantOrderNo 与 subject 必填');

    // 渠道解析：auto / 不传时由服务端路由，业务系统与 SDK 不必感知具体渠道
    const channel = await this.channelService.resolveChannel({
      requested: dto.channel,
      allowChannels: app.allowChannels,
      scene: dto.tradeType,
    });

    const amount = Money.round(dto.amount, 2);
    if (Money.D(app.limitPerOrder).gt(0) && amount.gt(Money.D(app.limitPerOrder))) {
      throw new BizException(ErrorCode.ORDER_AMOUNT_EXCEED_LIMIT, `单笔限额 ${app.limitPerOrder} 元`);
    }

    // JSAPI 必须传 openid
    if (channel === Channel.WECHAT && dto.tradeType === TradeType.JSAPI && !dto.payerId) {
      throw new BizException(ErrorCode.PARAM_ERROR, '微信 JSAPI 支付必须传 payerId（openid）');
    }

    // 2. 幂等：同 appId + merchantOrderNo 已存在则直接返回历史单
    const exist = await this.prisma.payOrder.findUnique({
      where: { appId_merchantOrderNo: { appId, merchantOrderNo: dto.merchantOrderNo } },
    });
    if (exist) {
      // 参数一致性校验：金额/渠道不一致视为冲突，拒绝
      if (!Money.eq(exist.amount, amount) || exist.channel !== channel) {
        this.logger.warn(
          `[idempotent-conflict] ${appId}/${dto.merchantOrderNo} 已存在但参数不一致: 存量 ${exist.amount}@${exist.channel} vs 请求 ${amount}@${channel}`,
        );
        throw new BizException(ErrorCode.ORDER_IDEMPOTENT_CONFLICT);
      }
      return this.buildOrderView(exist, true);
    }

    // 3. 生成订单号并调渠道下单
    const payOrderNo = OrderNoUtil.payOrderNo();
    const expireAt = new Date(Date.now() + (dto.expireMinutes || 30) * 60 * 1000);
    const adapter = await this.channelService.getAdapter(channel);

    let channelResult: any;
    try {
      channelResult = await adapter.createPayment({
        payOrderNo,
        merchantOrderNo: dto.merchantOrderNo,
        amount: amount.toString(),
        subject: dto.subject,
        body: dto.body,
        attach: dto.attach,
        tradeType: (dto.tradeType || TradeType.JSAPI) as TradeType,
        clientIp: dto.clientIp || clientIp,
        payerId: dto.payerId,
        expireAt,
        notifyUrl: dto.notifyUrl || (await this.payNotifyUrl(appId, channel)),
        appId,
      });
    } catch (e: any) {
      this.logger.error(`[createOrder] 渠道下单失败 ${e.message}`);
      throw new BizException(ErrorCode.CHANNEL_REQUEST_FAILED, e.message);
    }

    // 4. 落库（unique 约束兜住并发重复下单，冲突时按幂等返回已有单）
    try {
      const created = await this.prisma.payOrder.create({
        data: {
          payOrderNo,
          appId,
          merchantOrderNo: dto.merchantOrderNo,
          channel,
          channelMchId: adapter.mchId,
          tradeType: dto.tradeType || TradeType.JSAPI,
          amount,
          subject: dto.subject,
          body: dto.body,
          attach: dto.attach,
          clientIp: dto.clientIp || clientIp,
          payerId: dto.payerId,
          channelTxnId: channelResult.channelTxnId,
          status: PayOrderStatus.CREATED,
          expireAt,
          payParams: channelResult.payParams as any,
          channelRaw: channelResult.raw ?? undefined,
          extra: dto.extra ?? undefined,
        },
      });

      await this.opLog.write({
        operator: appId,
        operatorType: 'MERCHANT',
        module: 'order',
        action: 'create',
        targetId: payOrderNo,
        detail: `下单成功 ${amount}元 channel=${channel}`,
        ip: clientIp,
      });

      return this.buildOrderView(created, false, channelResult.payInfo);
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const dup = await this.prisma.payOrder.findUnique({
          where: { appId_merchantOrderNo: { appId, merchantOrderNo: dto.merchantOrderNo } },
        });
        if (dup) return this.buildOrderView(dup, true);
      }
      throw e;
    }
  }

  /**
   * 查询应用可用渠道（开放接口）
   * 业务系统可据此动态渲染收银台，不必把渠道列表写死在 SDK 里。
   */
  async listChannels(appId: string) {
    const app = await this.merchantService.getSecret(appId);
    return {
      defaultChannel: CHANNEL_AUTO,
      channels: this.channelService.listRoutableChannels(app.allowChannels),
    };
  }

  private async payNotifyUrl(appId: string, channel: string): Promise<string> {
    const row = await this.prisma.merchantApp.findUnique({ where: { appId } });
    return row?.payNotifyUrl || '';
  }

  // ==================== 支付查询 ====================

  async queryOrder(appId: string, dto: QueryOrderDto) {
    const where: any = { appId };
    if (dto.payOrderNo) where.payOrderNo = dto.payOrderNo;
    else if (dto.merchantOrderNo) where.merchantOrderNo = dto.merchantOrderNo;
    else throw new BizException(ErrorCode.PARAM_ERROR, 'payOrderNo 与 merchantOrderNo 至少传一个');

    const order = await this.prisma.payOrder.findFirst({ where });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND);

    // 非终态订单主动查渠道，补偿可能丢失的回调
    const nonFinal = ![PayOrderStatus.SUCCESS, PayOrderStatus.CLOSED, PayOrderStatus.REVOKED, PayOrderStatus.FAILED].includes(
      order.status as PayOrderStatus,
    );
    if (nonFinal || dto.force) {
      await this.syncFromChannel(order.payOrderNo);
    }
    const fresh = await this.prisma.payOrder.findUnique({ where: { payOrderNo: order.payOrderNo } });
    return this.buildOrderView(fresh || order, false);
  }

  /** 从渠道同步订单真实状态（回调丢失时的补偿手段） */
  async syncFromChannel(payOrderNo: string): Promise<void> {
    const order = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });
    if (!order) return;
    try {
      const adapter = await this.channelService.getAdapter(order.channel);
      const r = await adapter.queryPayment({ payOrderNo });
      if (!r.exist) {
        if (order.status === PayOrderStatus.CREATED || order.status === PayOrderStatus.PAYING) {
          await this.prisma.payOrder.update({
            where: { payOrderNo },
            data: { status: PayOrderStatus.CLOSED, closedAt: new Date() },
          });
        }
        return;
      }
      if (r.status === 'SUCCESS' && order.status !== PayOrderStatus.SUCCESS) {
        await this.markPaid(payOrderNo, {
          channelTxnId: r.channelTxnId,
          payerId: r.payerId,
          paidAmount: r.amount,
          paidAt: r.paidAt,
        });
      } else if (r.status === 'CLOSED' || r.status === 'REVOKED' || r.status === 'FAILED') {
        await this.prisma.payOrder.update({
          where: { payOrderNo },
          data: { status: r.status, closedAt: new Date() },
        });
      }
    } catch (e: any) {
      this.logger.warn(`[syncFromChannel] ${payOrderNo} 查询渠道失败: ${e.message}`);
    }
  }

  // ==================== 关闭订单 ====================

  async closeOrder(appId: string, dto: { payOrderNo?: string; merchantOrderNo?: string }, operator = appId) {
    const where: any = { appId };
    if (dto.payOrderNo) where.payOrderNo = dto.payOrderNo;
    else if (dto.merchantOrderNo) where.merchantOrderNo = dto.merchantOrderNo;
    else throw new BizException(ErrorCode.PARAM_ERROR, 'payOrderNo 与 merchantOrderNo 至少传一个');

    const order = await this.prisma.payOrder.findFirst({ where });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND);
    if (order.status === PayOrderStatus.SUCCESS) throw new BizException(ErrorCode.ORDER_ALREADY_PAID, '订单已支付，请走退款流程');
    if ([PayOrderStatus.CLOSED, PayOrderStatus.REVOKED].includes(order.status as PayOrderStatus)) {
      return this.buildOrderView(order, false);
    }

    // 关单前先查渠道，避免「渠道已支付但回调未到」被误关
    await this.syncFromChannel(order.payOrderNo);
    const fresh = await this.prisma.payOrder.findUnique({ where: { payOrderNo: order.payOrderNo } });
    if (fresh?.status === PayOrderStatus.SUCCESS) {
      throw new BizException(ErrorCode.ORDER_ALREADY_PAID, '渠道侧已支付成功，不能关闭');
    }

    try {
      const adapter = await this.channelService.getAdapter(order.channel);
      await adapter.closePayment({ payOrderNo: order.payOrderNo });
    } catch (e: any) {
      this.logger.warn(`[closeOrder] 渠道关单失败 ${order.payOrderNo}: ${e.message}`);
      // 渠道关单失败不阻断：本地仍关闭，由对账兜底
    }

    const updated = await this.prisma.payOrder.update({
      where: { payOrderNo: order.payOrderNo },
      data: { status: PayOrderStatus.CLOSED, closedAt: new Date() },
    });

    await this.opLog.write({
      operator,
      operatorType: operator === appId ? 'MERCHANT' : 'ADMIN',
      module: 'order',
      action: 'close',
      targetId: order.payOrderNo,
      detail: '关闭支付订单',
    });

    return this.buildOrderView(updated, false);
  }

  // ==================== 支付成功处理（回调 / 查单补偿共用） ====================

  /**
   * 标记订单支付成功
   * 使用带状态条件的原子更新保证幂等：并发回调只有一个能更新成功，
   * 从而避免重复通知业务系统
   */
  async markPaid(
    payOrderNo: string,
    data: { channelTxnId?: string; payerId?: string; paidAmount?: string; paidAt?: Date; raw?: any },
  ): Promise<{ updated: boolean; order?: any }> {
    const order = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });
    if (!order) return { updated: false };
    if (order.status === PayOrderStatus.SUCCESS) return { updated: false, order };

    const res = await this.prisma.payOrder.updateMany({
      where: { payOrderNo, status: { notIn: [PayOrderStatus.SUCCESS, PayOrderStatus.CLOSED, PayOrderStatus.REVOKED] } },
      data: {
        status: PayOrderStatus.SUCCESS,
        channelTxnId: data.channelTxnId || order.channelTxnId,
        payerId: data.payerId || order.payerId,
        paidAmount: data.paidAmount ? Money.round(data.paidAmount, 2) : Money.D(order.amount),
        paidAt: data.paidAt || new Date(),
        channelRaw: data.raw ?? undefined,
      },
    });

    if (res.count === 0) return { updated: false, order };

    const updated = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });

    // 触发异步通知（失败自动重试）
    await this.notifyService.enqueue({
      bizType: NotifyBizType.PAY,
      bizNo: payOrderNo,
      appId: order.appId,
      payload: buildPayNotifyPayload({
        appId: order.appId,
        payOrderNo,
        merchantOrderNo: order.merchantOrderNo,
        amount: Money.format(order.amount),
        paidAmount: updated?.paidAmount ? Money.format(updated.paidAmount) : undefined,
        channel: order.channel,
        channelTxnId: data.channelTxnId || order.channelTxnId || undefined,
        status: PayOrderStatus.SUCCESS,
        paidAt: updated?.paidAt || new Date(),
        subject: order.subject,
        attach: order.attach || undefined,
      }),
    });

    await this.opLog.write({
      operator: 'SYSTEM',
      operatorType: 'SYSTEM',
      module: 'order',
      action: 'paid',
      targetId: payOrderNo,
      detail: `支付成功 ${Money.format(order.amount)}元`,
    });

    return { updated: true, order: updated };
  }

  // ==================== 定时任务 ====================

  /** 关闭超时未支付订单（每分钟） */
  @Cron('0 * * * * *')
  async closeExpiredOrders(): Promise<void> {
    const expired = await this.prisma.payOrder.findMany({
      where: {
        status: { in: [PayOrderStatus.CREATED, PayOrderStatus.PAYING] },
        expireAt: { lt: new Date() },
      },
      take: 500,
      orderBy: { expireAt: 'asc' },
    });
    for (const o of expired) {
      try {
        // 关单前确认渠道状态，防止误关已支付单
        await this.syncFromChannel(o.payOrderNo);
        const fresh = await this.prisma.payOrder.findUnique({ where: { payOrderNo: o.payOrderNo } });
        if (!fresh || fresh.status !== PayOrderStatus.CREATED) continue;
        try {
          const adapter = await this.channelService.getAdapter(o.channel);
          await adapter.closePayment({ payOrderNo: o.payOrderNo });
        } catch {
          /* 渠道关单失败不阻断 */
        }
        await this.prisma.payOrder.update({
          where: { payOrderNo: o.payOrderNo },
          data: { status: PayOrderStatus.CLOSED, closedAt: new Date() },
        });
      } catch (e: any) {
        this.logger.error(`[closeExpired] ${o.payOrderNo}: ${e.message}`);
      }
    }
  }

  /** 支付中订单主动查单补偿（每 3 分钟）：防止渠道回调丢失导致业务系统收不到通知 */
  @Cron('0 */3 * * * *')
  async compensatePendingOrders(): Promise<void> {
    const threshold = new Date(Date.now() - PAYING_QUERY_DELAY_MINUTES * 60 * 1000);
    const pending = await this.prisma.payOrder.findMany({
      where: {
        status: { in: [PayOrderStatus.CREATED, PayOrderStatus.PAYING] },
        createdAt: { lt: threshold },
      },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });
    for (const o of pending) {
      await this.syncFromChannel(o.payOrderNo).catch((e) =>
        this.logger.error(`[compensate] ${o.payOrderNo}: ${e.message}`),
      );
    }
  }

  // ==================== 后台查询 ====================

  async adminList(params: {
    appId?: string;
    channel?: string;
    status?: string;
    payOrderNo?: string;
    merchantOrderNo?: string;
    channelTxnId?: string;
    startTime?: Date;
    endTime?: Date;
    minAmount?: number;
    maxAmount?: number;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.appId) where.appId = params.appId;
    if (params.channel) where.channel = params.channel;
    if (params.status) where.status = params.status;
    if (params.payOrderNo) where.payOrderNo = { contains: params.payOrderNo };
    if (params.merchantOrderNo) where.merchantOrderNo = { contains: params.merchantOrderNo };
    if (params.channelTxnId) where.channelTxnId = { contains: params.channelTxnId };
    if (params.minAmount !== undefined || params.maxAmount !== undefined) {
      where.amount = {};
      if (params.minAmount !== undefined) where.amount.gte = params.minAmount;
      if (params.maxAmount !== undefined) where.amount.lte = params.maxAmount;
    }
    if (params.startTime || params.endTime) {
      where.createdAt = {};
      if (params.startTime) where.createdAt.gte = params.startTime;
      if (params.endTime) where.createdAt.lte = params.endTime;
    }

    const [list, total, agg] = await Promise.all([
      this.prisma.payOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payOrder.count({ where }),
      this.prisma.payOrder.aggregate({
        where: { ...where, status: PayOrderStatus.SUCCESS },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return {
      list: list.map((o) => this.buildOrderView(o, false)),
      total,
      page,
      pageSize,
      summary: {
        successCount: agg._count._all,
        successAmount: agg._sum.amount ? Money.format(agg._sum.amount) : '0.00',
      },
    };
  }

  async detail(payOrderNo: string) {
    const order = await this.prisma.payOrder.findUnique({
      where: { payOrderNo },
      include: { refunds: true },
    });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND);
    return {
      ...this.buildOrderView(order, false),
      refunds: order.refunds.map((r) => ({
        refundNo: r.refundNo,
        merchantRefundNo: r.merchantRefundNo,
        amount: Money.format(r.amount),
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
        refundedAt: r.refundedAt,
      })),
    };
  }

  // ==================== 输出视图 ====================

  /**
   * preferredPayInfo：渠道适配器直接给出的统一形态（新渠道推荐提供）
   * 返回类型标注为 OpenApiOrderView —— 少返回任何一个契约字段都会导致构建失败
   */
  private buildOrderView(order: any, idempotentHit: boolean, preferredPayInfo?: PayInfo): OpenApiOrderView {
    return {
      payOrderNo: order.payOrderNo,
      merchantOrderNo: order.merchantOrderNo,
      appId: order.appId,
      channel: order.channel,
      channelMchId: order.channelMchId,
      tradeType: order.tradeType,
      amount: Money.format(order.amount),
      refundedAmount: Money.format(order.refundedAmount),
      paidAmount: order.paidAmount ? Money.format(order.paidAmount) : null,
      subject: order.subject,
      body: order.body,
      attach: order.attach,
      status: order.status,
      channelTxnId: order.channelTxnId,
      payerId: order.payerId,
      paidAt: order.paidAt,
      expireAt: order.expireAt,
      closedAt: order.closedAt,
      notifyStatus: order.notifyStatus,
      notifyCount: order.notifyCount,
      payParams: order.payParams,
      /** 统一形态的唤起信息：业务系统按 type 渲染即可，新增渠道无需改渲染逻辑 */
      payInfo: normalizePayInfo(order.tradeType, order.payParams, preferredPayInfo),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      idempotentHit,
    };
  }

  /** 生成用于签名演示的随机串（供文档/SDK 使用） */
  static randomNonce(): string {
    return CryptoUtil.randomString(16);
  }
}
