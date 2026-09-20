import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { MerchantService } from '../merchant/merchant.service';
import { ChannelService } from '../channel/channel.service';
import { LegalEntityService } from '../channel/legal-entity.service';
import { AdminAuthGuard, Roles, currentAdmin } from './admin-auth.guard';
import { AdminRole } from '../../common/constants/enums';

@ApiTags('管理后台-配置')
@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminConfigController {
  constructor(
    private readonly merchantService: MerchantService,
    private readonly channelService: ChannelService,
    private readonly legalEntityService: LegalEntityService,
  ) {}

  // ==================== 业务系统（AppId）====================

  @Get('merchants')
  @ApiOperation({ summary: '业务系统列表' })
  async merchants(@Req() req: Request) {
    return this.merchantService.list({ page: 1, pageSize: 100 });
  }

  @Post('merchants')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '创建业务系统（返回 AppId + AppSecret，Secret 仅返回一次）' })
  async createMerchant(@Req() req: Request, @Body() body: any) {
    return this.merchantService.create({
      ...body,
      operator: currentAdmin(req).username,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  @Put('merchants/:appId')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '修改业务系统配置' })
  async updateMerchant(@Req() req: Request, @Param('appId') appId: string, @Body() body: any) {
    return this.merchantService.update(appId, {
      ...body,
      operator: currentAdmin(req).username,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  @Post('merchants/:appId/reset-secret')
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '重置 AppSecret（仅超管）' })
  async resetSecret(@Req() req: Request, @Param('appId') appId: string) {
    return this.merchantService.resetSecret(appId, currentAdmin(req).username, (req.ip || '').replace('::ffff:', ''));
  }

  // ==================== 支付渠道 ====================

  @Get('channels')
  @ApiOperation({ summary: '渠道配置列表（敏感字段不返回）' })
  async channels() {
    return this.channelService.listConfigs();
  }

  @Post('channels')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '新增渠道配置' })
  async createChannel(@Req() req: Request, @Body() body: any) {
    return this.channelService.createConfig({
      ...body,
      operator: currentAdmin(req).username,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  @Put('channels/:id')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '修改渠道配置' })
  async updateChannel(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    return this.channelService.updateConfig(Number(id), {
      ...body,
      operator: currentAdmin(req).username,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  // ==================== 法人主体 ====================

  @Get('legal-entities')
  @ApiOperation({ summary: '法人主体列表（含引用的业务系统 / 渠道数量）' })
  async legalEntities(@Query('keyword') keyword?: string) {
    return this.legalEntityService.list(keyword);
  }

  @Post('legal-entities')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '新增法人主体' })
  async createLegalEntity(@Req() req: Request, @Body() body: any) {
    return this.legalEntityService.create({
      ...body,
      operator: currentAdmin(req).username,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  @Put('legal-entities/:id')
  @Roles(AdminRole.SUPER, AdminRole.OPERATOR)
  @ApiOperation({ summary: '修改法人主体' })
  async updateLegalEntity(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    return this.legalEntityService.update(Number(id), {
      ...body,
      operator: currentAdmin(req).username,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  @Delete('legal-entities/:id')
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '删除法人主体（仍被引用时拒绝，仅超管）' })
  async deleteLegalEntity(@Req() req: Request, @Param('id') id: string) {
    return this.legalEntityService.remove(
      Number(id),
      currentAdmin(req).username,
      (req.ip || '').replace('::ffff:', ''),
    );
  }
}
