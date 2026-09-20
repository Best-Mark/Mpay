import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PersonalQrService } from './personal-qr.service';
import { PersonalQrMonitorService } from './personal-qr-monitor.service';
import { AdminAuthGuard, currentAdmin, Roles } from '../admin/admin-auth.guard';
import { AdminRole } from '../../common/constants/enums';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { SystemConfigService } from '../../common/config/system-config.service';

/** 个人收款码管理：按业务系统维护收款码图片（上传走 /api/admin/upload）+ 到账事件挂账处理 */
@ApiTags('管理后台-个人收款码')
@Controller('api/admin/personal-qr')
@UseGuards(AdminAuthGuard)
export class AdminPersonalQrController {
  constructor(
    private readonly qrService: PersonalQrService,
    private readonly monitor: PersonalQrMonitorService,
    private readonly cfg: SystemConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: '收款码列表（可按 appId 过滤）' })
  async list(@Query('appId') appId?: string, @Query('enabledOnly') enabledOnly?: string) {
    return this.qrService.list({ appId, enabledOnly: enabledOnly === 'true' });
  }

  @Post()
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '新增收款码（imageUrl 来自上传接口）' })
  async create(@Req() req: Request, @Body() body: { appId: string; type: string; name?: string; imageUrl: string; enabled?: boolean }) {
    return this.qrService.create(body, currentAdmin(req).username);
  }

  @Put(':id')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '修改收款码（换图 / 改名 / 启停）' })
  async update(@Param('id') id: string, @Body() body: { type?: string; name?: string; imageUrl?: string; enabled?: boolean }) {
    return this.qrService.update(Number(id), body);
  }

  @Delete(':id')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '删除收款码' })
  async remove(@Param('id') id: string) {
    return this.qrService.remove(Number(id));
  }

  // ==================== 到账事件（监控器上报 / 挂账处理） ====================

  @Get('events')
  @ApiOperation({ summary: '到账事件列表（默认只返回未匹配的挂账）' })
  async events(
    @Query('appId') appId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.monitor.list({ appId, status, limit: Number(limit) || 50 });
  }

  /**
   * 人工绑定：把挂账的到账事件绑到订单并确认到账（补发通知）
   * 用于监控器上报时备注缺失、同额多单无法自动判定等场景
   */
  @Post('events/:id/bind')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '到账事件人工绑定订单并确认到账' })
  async bind(@Req() req: Request, @Param('id') id: string, @Body() body: { payOrderNo: string }) {
    if (!body?.payOrderNo) {
      throw new BizException(ErrorCode.PARAM_ERROR, 'payOrderNo 必填');
    }
    const res = await this.monitor.bind(Number(id), body.payOrderNo, currentAdmin(req).username);
    return { code: 0, message: res.updated ? '已确认到账并通知业务系统' : '订单状态未变更', data: res };
  }

  // ==================== 监控器上报 Token（给通知/短信转发类工具用） ====================

  /** 查询是否已配置 Token + 可直接复制给转发工具的上报地址 */
  @Get('monitor-token')
  @ApiOperation({ summary: '查看业务系统的监控器上报 Token 状态（不明文返回）' })
  async monitorToken(@Query('appId') appId?: string) {
    if (!appId) throw new BizException(ErrorCode.PARAM_ERROR, 'appId 必填');
    const status = await this.qrService.monitorTokenStatus(appId);
    return {
      ...status,
      reportPath: '/api/v1/open/qr/payment-report/text',
      hint: status.hasToken
        ? '明文仅在生成时返回一次；忘记请重新生成，旧 Token 立即失效'
        : '尚未生成 Token，转发工具无法上报',
    };
  }

  /** 生成 / 重置 Token：明文只在这一次返回 */
  @Post('monitor-token')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '生成或重置监控器上报 Token（旧 Token 立即失效）' })
  async issueMonitorToken(@Req() req: Request, @Body() body: { appId: string }) {
    const r = await this.qrService.issueMonitorToken(body?.appId);
    const { baseUrl } = await this.cfg.getSiteInfo();
    const base = (baseUrl || '').replace(/\/$/, '');
    return {
      code: 0,
      message: 'Token 已生成，旧 Token 立即失效',
      data: {
        ...r,
        reportUrl: `${base}/api/v1/open/qr/payment-report/text?token=${r.monitorToken}`,
        usage: '把通知/短信原文 POST 到该地址（body: { "text": "..." }），金额与时间由支付中心解析',
      },
      operator: currentAdmin(req).username,
    };
  }
}
