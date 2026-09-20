import { Body, Controller, Get, Logger, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { MonitorAuthGuard } from '../auth/monitor-auth.guard';
import { ApiVersionInterceptor } from '../../common/interceptors/api-version.interceptor';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { IncomingEventInput, PersonalQrMonitorService, RawTextInput } from './personal-qr-monitor.service';

/**
 * 个人收款码「到账监控」上报接口（供监控器调用）
 *
 * 鉴权：ApiSignGuard（X-App-Id + X-Timestamp + X-Nonce + X-Sign），与下单/退款同一套开放接口签名。
 * appId 一律取自签名身份，绝不信报文 —— 防止 A 商户把到账事件报到 B 商户头上。
 *
 * 监控器职责（端侧/网关程序，非本仓库范围）：
 *   监听微信「收款助手」/支付宝到账通知 → 解析出 { 金额, 备注, 时间, 流水号 } → 调用本接口上报
 */
@ApiTags('开放接口-个人码到账监控')
@Controller('api/v1/open/qr')
@UseGuards(MonitorAuthGuard)
@UseInterceptors(ApiVersionInterceptor)
export class PersonalQrMonitorController {
  private readonly logger = new Logger(PersonalQrMonitorController.name);

  constructor(private readonly monitor: PersonalQrMonitorService) {}

  /** 单笔到账上报 */
  @Post('payment-report')
  @ApiOperation({ summary: '上报一笔个人码到账（监控器 → 支付中心），命中订单即自动置成功并通知' })
  async report(@Req() req: Request, @Body() body: IncomingEventInput & { appId?: string }) {
    const appId = this.appIdOf(req);
    const data = await this.monitor.report(appId, body);
    return { code: 0, message: this.messageOf(data), data };
  }

  /** 批量上报（补推历史通知 / 断网重传） */
  @Post('payment-report/batch')
  @ApiOperation({ summary: '批量上报个人码到账（最多 200 条）' })
  async reportBatch(@Req() req: Request, @Body() body: { events: IncomingEventInput[] }) {
    const appId = this.appIdOf(req);
    if (!Array.isArray(body?.events)) throw new BizException(ErrorCode.PARAM_ERROR, 'events 必须是数组');
    const data = await this.monitor.reportBatch(appId, body.events);
    return { code: 0, message: `共 ${data.total} 条：自动匹配 ${data.matched} / 待处理 ${data.pending} / 失败 ${data.failed}`, data };
  }

  /**
   * 通知 / 短信原文上报（零开发方案专用）
   * 端侧（Tasker / MacroDroid / 短信转发器等）只需把到账通知原文原样 POST 上来，
   * 金额、账户类型、付款方、时间全部由支付中心解析 —— 端侧不用写任何解析逻辑。
   * ?dryRun=1 只解析不落库，用于配置转发规则时验证能否解析对。
   */
  @Post('payment-report/text')
  @ApiOperation({ summary: '按通知/短信原文上报到账（支付中心自动解析金额与账户，命中即自动置成功）' })
  async reportText(
    @Req() req: Request,
    @Query('dryRun') dryRun?: string,
    @Body() body?: RawTextInput,
  ) {
    const appId = this.appIdOf(req);
    const data = await this.monitor.reportText(appId, body as RawTextInput, dryRun === '1' || dryRun === 'true');
    if ((data as any).dryRun) {
      return { code: 0, message: '仅解析未落库', data };
    }
    return { code: 0, message: this.messageOf(data), data };
  }

  /** 查询本商户的到账事件（默认返回未匹配的挂账） */
  @Get('payment-events')
  @ApiOperation({ summary: '到账事件列表（默认只返回未匹配的挂账）' })
  async list(@Req() req: Request, @Query('status') status?: string, @Query('limit') limit?: string) {
    const appId = this.appIdOf(req);
    const data = await this.monitor.list({ appId, status, limit: Number(limit) || 50 });
    return { code: 0, message: 'ok', data };
  }

  private appIdOf(req: Request): string {
    const appId = (req as any).merchantApp?.appId;
    if (!appId) throw new BizException(ErrorCode.SIGN_MISSING, '无法从签名中识别 AppId');
    return appId;
  }

  private messageOf(data: any): string {
    if (data?.duplicate) return '重复上报已忽略';
    const st = data?.event?.matchStatus;
    if (st === 'MATCHED') return `已自动匹配订单 ${data?.payOrderNo || ''} 并通知业务系统`;
    if (st === 'PENDING') return '已记录，等待人工确认（自动确认已关闭）';
    if (st === 'AMBIGUOUS') return '同额订单多笔，已挂账待人工确认';
    return '未匹配到订单，已挂账待人工确认';
  }
}
