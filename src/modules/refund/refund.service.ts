import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MerchantService } from '../merchant/merchant.service';
import { ChannelService } from '../channel/channel.service';
import { NotifyService, buildRefundNotifyPayload } from '../notify/notify.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { OrderNoUtil } from '../../common/utils/order-no';
import { Money } from '../../common/utils/money';
import { BizException, assertParam } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { NotifyBizType, PayOrderStatus, RefundStatus } from '../../common/constants/enums';
import { CreateRefundDto, QueryRefundDto } from './refund.dto';

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantService: MerchantService,
    private readonly channelService: ChannelService,
    private readonly notifyService: NotifyService,
    private readonly opLog: OperationLogService,
  ) {}

  // ==================== 申请退款 ====================

  async createRefund(appId: string, dto: CreateRefundDto, clientIp?: string) {
    await this.merchantService.getSecret(appId); // 校验商户有效
    assertParam(!!dto.payOrderNo || !!dto.merchantOrderNo, 'payOrderNo 与 merchantOrderNo 至少传一个');
    assertParam(!!dto.merchantRefundNo, 'merchantRefundNo 必填');

    // 1. 幂等：已有相同业务退款单号则直接返回
    const exist = await this.prisma.refundOrder.findUnique({
      where: { appId_merchantRefundNo: { appId, merchantRefundNo: dto.merchantRefundNo } },
    });
    if (exist) {
      if (dto.amount !== undefined && !Money.eq(exist.amount, dto.amount)) {
        throw new BizException(ErrorCode.REFUND_IDEMPOTENT_CONFLICT);
      }
      return this.buildView(exist, true);
    }

    // 2. 查原订单
    const where: any = { appId };
    if (dto.payOrderNo) where.payOrderNo = dto.payOrderNo;
    else where.merchantOrderNo = dto.merchantOrderNo;
    const order = await this.prisma.payOrder.findFirst({ where });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND, '原支付订单不存在');
    if (order.status !== PayOrderStatus.SUCCESS && order.status !== PayOrderStatus.REFUNDING) {
      throw new BizException(ErrorCode.REFUND_ORDER_NOT_PAID, '原订单未支付成功，不能退款');
    }

    // 3. 金额校验：可退金额 = 订单金额 - 已退金额
    const refundable = Money.sub(order.amount, order.refundedAmount);
    const amount = dto.amount === undefined ? refundable : Money.round(dto.amount, 2);
    assertParam(Money.isValid(amount.toString()), '退款金额不合法');
    if (Money.gt(amount, refundable)) {
      throw new BizException(ErrorCode.REFUND_AMOUNT_EXCEED, `可退金额仅剩 ${Money.format(refundable)} 元`);
    }

    // 4. 并发安全：原子占用可退额度（防止并发退款超额）
    const occupy = await this.prisma.payOrder.updateMany({
      where: { payOrderNo: order.payOrderNo, refundedAmount: { lte: Money.sub(order.amount, amount).toString() as any } },
      data: { refundedAmount: { increment: amount.toString() as any }, status: PayOrderStatus.REFUNDING },
    });
    if (occupy.count === 0) {
      throw new BizException(ErrorCode.REFUND_AMOUNT_EXCEED, '并发退款导致可退额度不足');
    }

    const refundNo = OrderNoUtil.refundNo();
    let created: any;
    try {
      created = await this.prisma.refundOrder.create({
        data: {
          refundNo,
          payOrderNo: order.payOrderNo,
          appId,
          merchantRefundNo: dto.merchantRefundNo,
          merchantOrderNo: order.merchantOrderNo,
          channel: order.channel,
          channelMchId: order.channelMchId,
          amount,
          payAmount: order.amount,
          reason: dto.reason,
          status: RefundStatus.CREATED,
          extra: dto.extra ?? undefined,
        },
      });

      // 5. 调渠道退款
      const adapter = await this.channelService.getAdapter(order.channel);
      const notifyUrl = dto.notifyUrl || (await this.resolveNotifyUrl(appId));
      const r = await adapter.refund({
        refundNo,
        payOrderNo: order.payOrderNo,
        channelTxnId: order.channelTxnId || undefined,
        payAmount: Money.format(order.amount),
        refundAmount: Money.format(amount),
        reason: dto.reason,
        notifyUrl,
      });

      created = await this.prisma.refundOrder.update({
        where: { refundNo },
        data: {
          status: r.status,
          channelRefundId: r.channelRefundId,
          channelRefundStatus: r.channelStatus,
          fundsAccount: r.fundsAccount,
          failReason: r.failReason,
          refundedAt: r.status === RefundStatus.SUCCESS ? new Date() : undefined,
          channelRaw: r.raw ?? undefined,
        },
      });

      if (r.status === RefundStatus.FAILED || r.status === RefundStatus.CLOSED) {
        // 渠道失败：回滚占用额度
        await this.rollbackOccupy(order.payOrderNo, amount);
      } else if (r.status === RefundStatus.SUCCESS) {
        await this.afterRefundSuccess(created, order);
      }

      await this.opLog.write({
        operator: appId,
        operatorType: 'MERCHANT',
        module: 'refund',
        action: 'create',
        targetId: refundNo,
        detail: `发起退款 ${Money.format(amount)}元，原因：${dto.reason || '未填写'}`,
        ip: clientIp,
      });
    } catch (e: any) {
      // 异常时回滚额度占用
      await this.rollbackOccupy(order.payOrderNo, amount).catch(() => undefined);
      if (e instanceof BizException) throw e;
      this.logger.error(`[refund] ${refundNo} 失败: ${e.message}`);
      throw new BizException(ErrorCode.REFUND_CHANNEL_FAILED, e.message);
    }

    return this.buildView(created, false);
  }

  private async rollbackOccupy(payOrderNo: string, amount: any): Promise<void> {
    await this.prisma.payOrder.update({
      where: { payOrderNo },
      data: { refundedAmount: { decrement: amount.toString() as any } },
    });
    const o = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });
    if (o && Money.D(o.refundedAmount).lte(0) && o.status === PayOrderStatus.REFUNDING) {
      await this.prisma.payOrder.update({ where: { payOrderNo }, data: { status: PayOrderStatus.SUCCESS } });
    } else if (o && Money.D(o.refundedAmount).gte(Money.D(o.amount)) && o.status === PayOrderStatus.REFUNDING) {
      await this.prisma.payOrder.update({ where: { payOrderNo }, data: { status: PayOrderStatus.REFUNDED } });
    }
  }

  private async resolveNotifyUrl(appId: string): Promise<string | undefined> {
    const row = await this.prisma.merchantApp.findUnique({ where: { appId } });
    return row?.refundNotifyUrl || row?.payNotifyUrl || undefined;
  }

  /** 退款成功后的收尾：更新主订单状态 + 通知业务系统 */
  private async afterRefundSuccess(refund: any, order?: any): Promise<void> {
    const payOrder = order || (await this.prisma.payOrder.findUnique({ where: { payOrderNo: refund.payOrderNo } }));
    if (payOrder && Money.D(payOrder.refundedAmount).gte(Money.D(payOrder.amount))) {
      await this.prisma.payOrder.update({
        where: { payOrderNo: payOrder.payOrderNo },
        data: { status: PayOrderStatus.REFUNDED },
      });
    }

    await this.notifyService.enqueue({
      bizType: NotifyBizType.REFUND,
      bizNo: refund.refundNo,
      appId: refund.appId,
      payload: buildRefundNotifyPayload({
        appId: refund.appId,
        refundNo: refund.refundNo,
        merchantRefundNo: refund.merchantRefundNo,
        payOrderNo: refund.payOrderNo,
        merchantOrderNo: refund.merchantOrderNo || undefined,
        refundAmount: Money.format(refund.amount),
        status: RefundStatus.SUCCESS,
        refundedAt: refund.refundedAt || new Date(),
        reason: refund.reason || undefined,
      }),
    });
  }

  // ==================== 退款查询 ====================

  async queryRefund(appId: string, dto: QueryRefundDto) {
    const where: any = { appId };
    if (dto.refundNo) where.refundNo = dto.refundNo;
    else if (dto.merchantRefundNo) where.merchantRefundNo = dto.merchantRefundNo;
    else throw new BizException(ErrorCode.PARAM_ERROR, 'refundNo 与 merchantRefundNo 至少传一个');

    const refund = await this.prisma.refundOrder.findFirst({ where });
    if (!refund) throw new BizException(ErrorCode.REFUND_NOT_FOUND);

    if (refund.status === RefundStatus.PROCESSING || refund.status === RefundStatus.CREATED || dto.force) {
      await this.syncFromChannel(refund.refundNo);
    }
    const fresh = await this.prisma.refundOrder.findUnique({ where: { refundNo: refund.refundNo } });
    return this.buildView(fresh || refund, false);
  }

  async syncFromChannel(refundNo: string): Promise<void> {
    const refund = await this.prisma.refundOrder.findUnique({ where: { refundNo } });
    if (!refund) return;
    if ([RefundStatus.SUCCESS, RefundStatus.FAILED, RefundStatus.CLOSED].includes(refund.status as RefundStatus)) return;

    try {
      const adapter = await this.channelService.getAdapter(refund.channel);
      const r = await adapter.queryRefund({
        refundNo,
        channelRefundId: refund.channelRefundId || undefined,
      });
      if (!r.exist) return;

      if (r.status === RefundStatus.SUCCESS && refund.status !== RefundStatus.SUCCESS) {
        const updated = await this.prisma.refundOrder.update({
          where: { refundNo },
          data: { status: RefundStatus.SUCCESS, refundedAt: r.refundedAt || new Date(), channelRefundStatus: r.channelStatus },
        });
        await this.afterRefundSuccess(updated);
      } else if (r.status === RefundStatus.FAILED) {
        await this.prisma.refundOrder.update({
          where: { refundNo },
          data: { status: RefundStatus.FAILED, failReason: r.failReason, channelRefundStatus: r.channelStatus },
        });
        await this.rollbackOccupy(refund.payOrderNo, refund.amount);
      } else if (r.status === RefundStatus.CLOSED) {
        await this.prisma.refundOrder.update({
          where: { refundNo },
          data: { status: RefundStatus.CLOSED, channelRefundStatus: r.channelStatus },
        });
        await this.rollbackOccupy(refund.payOrderNo, refund.amount);
      }
    } catch (e: any) {
      this.logger.warn(`[refund sync] ${refundNo}: ${e.message}`);
    }
  }

  // ==================== 渠道退款回调 ====================

  async handleRefundNotify(params: {
    refundNo: string;
    status: 'SUCCESS' | 'FAILED' | 'PROCESSING' | 'CLOSED';
    channelRefundId?: string;
    refundAmount?: string;
    refundedAt?: Date;
    raw?: any;
  }): Promise<void> {
    const refund = await this.prisma.refundOrder.findUnique({ where: { refundNo: params.refundNo } });
    if (!refund) {
      this.logger.warn(`[refund notify] 退款单不存在: ${params.refundNo}`);
      return;
    }
    if (refund.status === RefundStatus.SUCCESS) return; // 幂等

    if (params.status === 'SUCCESS') {
      const updated = await this.prisma.refundOrder.update({
        where: { refundNo: params.refundNo },
        data: {
          status: RefundStatus.SUCCESS,
          channelRefundId: params.channelRefundId || refund.channelRefundId,
          refundedAt: params.refundedAt || new Date(),
          channelRaw: params.raw ?? undefined,
        },
      });
      await this.afterRefundSuccess(updated);
    } else if (params.status === 'FAILED' || params.status === 'CLOSED') {
      await this.prisma.refundOrder.update({
        where: { refundNo: params.refundNo },
        data: { status: params.status === 'FAILED' ? RefundStatus.FAILED : RefundStatus.CLOSED },
      });
      await this.rollbackOccupy(refund.payOrderNo, refund.amount);
    }
  }

  /** 定时补偿：处理中退款主动查渠道（每 5 分钟） */
  @Cron('0 */5 * * * *')
  async compensateProcessingRefunds(): Promise<void> {
    const list = await this.prisma.refundOrder.findMany({
      where: { status: { in: [RefundStatus.CREATED, RefundStatus.PROCESSING] } },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });
    for (const r of list) {
      await this.syncFromChannel(r.refundNo).catch((e) => this.logger.error(`[refund compensate] ${r.refundNo}: ${e.message}`));
    }
  }

  // ==================== 后台管理 ====================

  async adminList(params: {
    appId?: string;
    channel?: string;
    status?: string;
    refundNo?: string;
    merchantRefundNo?: string;
    payOrderNo?: string;
    startTime?: Date;
    endTime?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.appId) where.appId = params.appId;
    if (params.channel) where.channel = params.channel;
    if (params.status) where.status = params.status;
    if (params.refundNo) where.refundNo = { contains: params.refundNo };
    if (params.merchantRefundNo) where.merchantRefundNo = { contains: params.merchantRefundNo };
    if (params.payOrderNo) where.payOrderNo = { contains: params.payOrderNo };
    if (params.startTime || params.endTime) {
      where.createdAt = {};
      if (params.startTime) where.createdAt.gte = params.startTime;
      if (params.endTime) where.createdAt.lte = params.endTime;
    }

    const [list, total, agg] = await Promise.all([
      this.prisma.refundOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.refundOrder.count({ where }),
      this.prisma.refundOrder.aggregate({
        where: { ...where, status: RefundStatus.SUCCESS },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return {
      list: list.map((r) => this.buildView(r, false)),
      total,
      page,
      pageSize,
      summary: {
        successCount: agg._count._all,
        successAmount: agg._sum.amount ? Money.format(agg._sum.amount) : '0.00',
      },
    };
  }

  /** 后台人工重试失败的退款（渠道返回失败后，修复配置可重新发起） */
  async retryRefund(refundNo: string, operator: string): Promise<any> {
    const refund = await this.prisma.refundOrder.findUnique({ where: { refundNo } });
    if (!refund) throw new BizException(ErrorCode.REFUND_NOT_FOUND);
    if (![RefundStatus.FAILED, RefundStatus.CLOSED].includes(refund.status as RefundStatus)) {
      throw new BizException(ErrorCode.REFUND_STATUS_INVALID, '仅失败/关闭的退款单可重试');
    }
    const order = await this.prisma.payOrder.findUnique({ where: { payOrderNo: refund.payOrderNo } });
    const adapter = await this.channelService.getAdapter(refund.channel);
    const r = await adapter.refund({
      refundNo: refund.refundNo,
      payOrderNo: refund.payOrderNo,
      channelTxnId: order?.channelTxnId || undefined,
      payAmount: Money.format(refund.payAmount),
      refundAmount: Money.format(refund.amount),
      reason: refund.reason || undefined,
      notifyUrl: await this.resolveNotifyUrl(refund.appId),
    });

    const updated = await this.prisma.refundOrder.update({
      where: { refundNo },
      data: {
        status: r.status,
        channelRefundId: r.channelRefundId || refund.channelRefundId,
        channelRefundStatus: r.channelStatus,
        failReason: r.failReason,
        refundedAt: r.status === RefundStatus.SUCCESS ? new Date() : undefined,
      },
    });
    if (r.status === RefundStatus.SUCCESS) await this.afterRefundSuccess(updated);

    await this.opLog.write({
      operator,
      operatorType: 'ADMIN',
      module: 'refund',
      action: 'retry',
      targetId: refundNo,
      detail: `人工重试退款，结果：${r.status}`,
    });
    return this.buildView(updated, false);
  }

  private buildView(r: any, idempotentHit: boolean) {
    return {
      refundNo: r.refundNo,
      merchantRefundNo: r.merchantRefundNo,
      payOrderNo: r.payOrderNo,
      merchantOrderNo: r.merchantOrderNo,
      appId: r.appId,
      channel: r.channel,
      channelMchId: r.channelMchId,
      amount: Money.format(r.amount),
      payAmount: Money.format(r.payAmount),
      status: r.status,
      channelRefundId: r.channelRefundId,
      channelRefundStatus: r.channelRefundStatus,
      reason: r.reason,
      failReason: r.failReason,
      refundedAt: r.refundedAt,
      notifyStatus: r.notifyStatus,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      idempotentHit,
    };
  }
}
