import { Body, Controller, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { CreateOrderDto, QueryOrderDto, CloseOrderDto, ConfirmPaidDto } from './payment.dto';
import { ApiSignGuard } from '../auth/api-sign.guard';
import { assertParam } from '../../common/exceptions/biz.exception';
import { ApiVersionInterceptor } from '../../common/interceptors/api-version.interceptor';

/**
 * 开放接口（供各业务系统调用）
 * 路由前缀：/api/v1/open/pay
 * 鉴权：ApiSignGuard（X-App-Id + X-Timestamp + X-Nonce + X-Sign）
 */
@ApiTags('开放接口-支付')
@Controller('api/v1/open/pay')
@UseGuards(ApiSignGuard)
@UseInterceptors(ApiVersionInterceptor)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create')
  @ApiOperation({ summary: '创建支付订单（幂等：同一 merchantOrderNo 重复请求返回同一订单）' })
  async create(@Req() req: Request, @Body() dto: CreateOrderDto) {
    const appId = (req as any).merchantApp.appId as string;
    const ip = (req as any).clientIp as string;
    return this.paymentService.createOrder(appId, dto, ip);
  }

  @Post('channels')
  @ApiOperation({ summary: '查询当前应用可用支付渠道（新增渠道后自动出现，无需升级 SDK）' })
  async channels(@Req() req: Request) {
    const appId = (req as any).merchantApp.appId as string;
    return this.paymentService.listChannels(appId);
  }

  @Post('query')
  @ApiOperation({ summary: '查询支付订单状态（支持 payOrderNo 或 merchantOrderNo）' })
  async query(@Req() req: Request, @Body() dto: QueryOrderDto) {
    const appId = (req as any).merchantApp.appId as string;
    assertParam(!!dto.payOrderNo || !!dto.merchantOrderNo, 'payOrderNo 与 merchantOrderNo 至少传一个');
    return this.paymentService.queryOrder(appId, dto);
  }

  @Post('close')
  @ApiOperation({ summary: '关闭未支付订单' })
  async close(@Req() req: Request, @Body() dto: CloseOrderDto) {
    const appId = (req as any).merchantApp.appId as string;
    return this.paymentService.closeOrder(appId, dto, appId);
  }

  /**
   * 商户自助确认到账（个人收款码专用）
   * 商户在自己系统里核对微信/支付宝账单后调用，效果与后台「确认到账」一致：
   * 置成功 + 通知业务系统。有官方回调的渠道调用会被拒绝。
   */
  @Post('confirm-paid')
  @ApiOperation({ summary: '商户自助确认到账（仅个人收款码渠道），确认后置成功并通知' })
  async confirmPaid(@Req() req: Request, @Body() dto: ConfirmPaidDto) {
    const appId = (req as any).merchantApp.appId as string;
    return this.paymentService.confirmPaidByMerchant(appId, dto);
  }
}
