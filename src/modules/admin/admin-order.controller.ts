import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
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
  constructor(
    private readonly paymentService: PaymentService,
    private readonly refundService: RefundService,
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
