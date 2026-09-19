import { Body, Controller, Get, Logger, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { Channel, PayOrderStatus } from '../../common/constants/enums';
import { AdminAuthGuard, currentAdmin } from './admin-auth.guard';
import dayjs from 'dayjs';

function parseDate(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = dayjs(v).isValid() ? dayjs(v) : null;
  return d ? d.toDate() : undefined;
}

@ApiTags('管理后台-订单与退款')
@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminOrderController {
  private readonly logger = new Logger(AdminOrderController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly refundService: RefundService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('orders')
  @ApiOperation({ summary: '支付订单查询（多条件筛选）' })
  async orders(@Query() q: any) {
    return this.paymentService.adminList({
      appId: q.appId,
      channel: q.channel,
      status: q.status,
      payOrderNo: q.payOrderNo,
      merchantOrderNo: q.merchantOrderNo,
      channelTxnId: q.channelTxnId,
      startTime: parseDate(q.startTime),
      endTime: parseDate(q.endTime),
      minAmount: q.minAmount !== undefined ? Number(q.minAmount) : undefined,
      maxAmount: q.maxAmount !== undefined ? Number(q.maxAmount) : undefined,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Get('orders/:payOrderNo')
  @ApiOperation({ summary: '订单详情（含退款记录）' })
  async orderDetail(@Param('payOrderNo') payOrderNo: string) {
    return this.paymentService.detail(payOrderNo);
  }

  @Post('orders/:payOrderNo/close')
  @ApiOperation({ summary: '后台关闭订单' })
  async closeOrder(@Req() req: Request, @Param('payOrderNo') payOrderNo: string) {
    const admin = currentAdmin(req);
    const order = await this.paymentService.adminList({ payOrderNo, pageSize: 1 });
    const appId = order.list[0]?.appId;
    if (!appId) return { success: false };
    return this.paymentService.closeOrder(appId, { payOrderNo }, admin.username);
  }

  /**
   * 人工确认到账（个人收款码渠道专用）
   *
   * 个人收款码没有渠道回调，是否到账由收款方在自己的微信/支付宝账单核对后在此确认。
   * 确认后订单状态流转与异步通知与正式渠道完全一致 —— 业务系统收到的回调参数无差异。
   */
  @Post('orders/:payOrderNo/confirm-paid')
  @ApiOperation({ summary: '人工确认到账（个人收款码渠道），确认后触发异步通知' })
  async confirmPaid(
    @Req() req: Request,
    @Param('payOrderNo') payOrderNo: string,
    @Body() body?: { paidAmount?: string; payerId?: string; remark?: string },
  ) {
    const admin = currentAdmin(req);
    const order = await this.prisma.payOrder.findUnique({ where: { payOrderNo } });
    if (!order) throw new BizException(ErrorCode.ORDER_NOT_FOUND);
    if (order.channel !== Channel.PERSONAL_QR) {
      throw new BizException(ErrorCode.PARAM_ERROR, `订单渠道为 ${order.channel}，无需人工确认（请走渠道回调 / 主动查单）`);
    }
    if (order.status === PayOrderStatus.SUCCESS) return { code: 0, message: '订单已支付成功', data: { updated: false } };
    if ([PayOrderStatus.CLOSED, PayOrderStatus.REVOKED].includes(order.status as PayOrderStatus)) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '订单已关闭，无法确认到账');
    }

    const res = await this.paymentService.markPaid(payOrderNo, {
      channelTxnId: `QRMANUAL${Date.now()}`,
      payerId: body?.payerId || order.payerId || undefined,
      paidAmount: body?.paidAmount || Number(order.amount).toFixed(2),
      raw: { source: 'admin-confirm', operator: admin.username, remark: body?.remark || '' },
    });
    this.logger.log(`[personal-qr] 人工确认到账 ${payOrderNo} by=${admin.username} 金额=${body?.paidAmount || order.amount}`);
    return { code: 0, message: res.updated ? '已确认到账并通知业务系统' : '订单状态未变更', data: res };
  }

  @Get('refunds')
  @ApiOperation({ summary: '退款单查询' })
  async refunds(@Query() q: any) {
    return this.refundService.adminList({
      appId: q.appId,
      channel: q.channel,
      status: q.status,
      refundNo: q.refundNo,
      merchantRefundNo: q.merchantRefundNo,
      payOrderNo: q.payOrderNo,
      startTime: parseDate(q.startTime),
      endTime: parseDate(q.endTime),
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Post('refunds/:refundNo/retry')
  @ApiOperation({ summary: '重试失败的退款' })
  async retryRefund(@Req() req: Request, @Param('refundNo') refundNo: string) {
    return this.refundService.retryRefund(refundNo, currentAdmin(req).username);
  }
}
