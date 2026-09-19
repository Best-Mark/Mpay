import { Controller, Param, Post, Req, Res, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelService } from '../channel/channel.service';
import { PaymentService } from '../payment/payment.service';
import { RefundService } from '../refund/refund.service';
import { PayOrderStatus } from '../../common/constants/enums';

/**
 * 渠道异步回调入口（渠道 -> 支付中心）
 * 路由：/api/v1/notify/:channel/pay  与  /api/v1/notify/:channel/refund
 * 说明：
 *  - 不做 ApiSignGuard 鉴权（渠道无法按我们的规则签名），安全性由渠道自身的验签保证
 *  - 原始报文先落 ChannelNotifyLog，便于事后排查「渠道说通知了但订单没变」这类问题
 */
@ApiTags('渠道回调')
@Controller('api/v1/notify')
export class NotifyController {
  private readonly logger = new Logger(NotifyController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly paymentService: PaymentService,
    private readonly refundService: RefundService,
  ) {}

  private async handle(@Param('channel') channel: string, type: 'pay' | 'refund', req: Request, res: Response) {
    const rawBody = (req as any).rawBody || '';
    let signOk = false;
    let parsed: any = null;
    let adapter: any = null;

    try {
      adapter = await this.channelService.getAdapter(channel);
      parsed = await adapter.parseNotify({ headers: req.headers, rawBody, query: req.query as any });
      signOk = true;
    } catch (e: any) {
      this.logger.error(`[notify:${channel}] 解析/验签失败: ${e.message}`);
      await this.log(channel, type, null, null, false, 'FAILED', rawBody, e.message);
      const r = adapter
        ? adapter.notifyResponse(false, e.message)
        : { body: 'fail', contentType: 'text/plain' };
      res.status(200).set('Content-Type', r.contentType || 'application/json').send(r.body);
      return;
    }

    try {
      if (type === 'pay') {
        await this.handlePay(parsed);
      } else {
        await this.refundService.handleRefundNotify({
          refundNo: parsed.refundNo,
          status: parsed.refundStatus || 'PROCESSING',
          channelRefundId: parsed.tradeNo,
          refundAmount: parsed.refundAmount,
          refundedAt: parsed.paidAt,
          raw: parsed.raw,
        });
      }
      await this.log(channel, type, parsed.payOrderNo, parsed.tradeNo, signOk, 'SUCCESS', rawBody);
      const r = adapter.notifyResponse(true);
      res.status(200).set('Content-Type', r.contentType || 'application/json').send(r.body);
    } catch (e: any) {
      this.logger.error(`[notify:${channel}] 处理失败: ${e.message}`);
      await this.log(channel, type, parsed.payOrderNo, parsed.tradeNo, signOk, 'FAILED', rawBody, e.message);
      const r = adapter.notifyResponse(false, e.message);
      res.status(200).set('Content-Type', r.contentType || 'application/json').send(r.body);
    }
  }

  private async handlePay(parsed: any): Promise<void> {
    if (!parsed?.payOrderNo) throw new Error('回调缺少商户订单号');

    if (parsed.status === 'SUCCESS') {
      await this.paymentService.markPaid(parsed.payOrderNo, {
        channelTxnId: parsed.tradeNo,
        payerId: parsed.payerId,
        paidAmount: parsed.amount,
        paidAt: parsed.paidAt,
        raw: parsed.raw,
      });
      return;
    }

    if (parsed.status === 'CLOSED' || parsed.status === 'REVOKED' || parsed.status === 'FAILED') {
      await this.prisma.payOrder.updateMany({
        where: {
          payOrderNo: parsed.payOrderNo,
          status: { notIn: [PayOrderStatus.SUCCESS, PayOrderStatus.CLOSED, PayOrderStatus.REVOKED] },
        },
        data: { status: parsed.status, closedAt: new Date() },
      });
    }
  }

  private async log(
    channel: string,
    notifyType: string,
    payOrderNo: string | null,
    tradeNo: string | null,
    signOk: boolean,
    result: string,
    rawBody: string,
    errorMsg?: string,
  ): Promise<void> {
    try {
      await this.prisma.channelNotifyLog.create({
        data: {
          channel,
          notifyType: notifyType.toUpperCase(),
          payOrderNo,
          tradeNo,
          signOk,
          handleResult: result,
          raw: { headers: {}, body: rawBody?.slice(0, 5000) },
          errorMsg,
        },
      });
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  @Post(':channel/pay')
  @ApiOperation({ summary: '支付结果回调（微信/支付宝/Mock）' })
  async pay(@Param('channel') channel: string, @Req() req: Request, @Res() res: Response) {
    await this.handle(channel, 'pay', req, res);
  }

  @Post(':channel/refund')
  @ApiOperation({ summary: '退款结果回调（微信/支付宝/Mock）' })
  async refund(@Param('channel') channel: string, @Req() req: Request, @Res() res: Response) {
    await this.handle(channel, 'refund', req, res);
  }
}
