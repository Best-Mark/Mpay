import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PortalService } from '../portal/portal.service';
import { AdminAuthGuard, currentAdmin } from './admin-auth.guard';

/**
 * 商户入驻审核
 * 通过即为其开通业务系统（AppId/AppSecret），密钥明文只在此次响应中出现一次
 */
@ApiTags('管理后台-商户入驻')
@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminPortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('merchant-users')
  @ApiOperation({ summary: '商户账号列表' })
  async list(@Query() q: any) {
    return this.portal.list({
      status: q.status,
      keyword: q.keyword,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Post('merchant-users/:id/approve')
  @ApiOperation({ summary: '审核通过并开通业务系统' })
  async approve(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    return this.portal.approve(
      Number(id),
      {
        payNotifyUrl: body?.payNotifyUrl,
        refundNotifyUrl: body?.refundNotifyUrl,
        allowChannels: body?.allowChannels,
        limitPerOrder: body?.limitPerOrder,
        limitDaily: body?.limitDaily,
        limitMonthly: body?.limitMonthly,
        remark: body?.remark,
      },
      currentAdmin(req).username,
      (req.ip || '').replace('::ffff:', ''),
    );
  }

  @Post('merchant-users/:id/reject')
  @ApiOperation({ summary: '驳回入驻申请' })
  async reject(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.portal.reject(
      Number(id),
      body?.reason || '未说明',
      currentAdmin(req).username,
      (req.ip || '').replace('::ffff:', ''),
    );
  }

  @Put('merchant-users/:id/status')
  @ApiOperation({ summary: '启用/停用商户账号（连带启停其业务系统）' })
  async setStatus(@Req() req: Request, @Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'DISABLED' }) {
    return this.portal.setStatus(
      Number(id),
      body?.status,
      currentAdmin(req).username,
      (req.ip || '').replace('::ffff:', ''),
    );
  }
}
