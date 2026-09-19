import { Body, Controller, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RefundService } from './refund.service';
import { CreateRefundDto, QueryRefundDto } from './refund.dto';
import { ApiSignGuard } from '../auth/api-sign.guard';
import { assertParam } from '../../common/exceptions/biz.exception';
import { ApiVersionInterceptor } from '../../common/interceptors/api-version.interceptor';

@ApiTags('开放接口-退款')
@Controller('api/v1/open/refund')
@UseGuards(ApiSignGuard)
@UseInterceptors(ApiVersionInterceptor)
export class RefundController {
  constructor(private readonly refundService: RefundService) {}

  @Post('create')
  @ApiOperation({ summary: '申请退款（支持全额/部分退款，幂等）' })
  async create(@Req() req: Request, @Body() dto: CreateRefundDto) {
    const appId = (req as any).merchantApp.appId as string;
    const ip = (req as any).clientIp as string;
    return this.refundService.createRefund(appId, dto, ip);
  }

  @Post('query')
  @ApiOperation({ summary: '查询退款状态' })
  async query(@Req() req: Request, @Body() dto: QueryRefundDto) {
    const appId = (req as any).merchantApp.appId as string;
    assertParam(!!dto.refundNo || !!dto.merchantRefundNo, 'refundNo 与 merchantRefundNo 至少传一个');
    return this.refundService.queryRefund(appId, dto);
  }
}
