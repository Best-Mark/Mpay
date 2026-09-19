import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PersonalQrService } from './personal-qr.service';
import { AdminAuthGuard, currentAdmin, Roles } from '../admin/admin-auth.guard';
import { AdminRole } from '../../common/constants/enums';

/** 个人收款码管理：按业务系统维护收款码图片（上传走 /api/admin/upload） */
@ApiTags('管理后台-个人收款码')
@Controller('api/admin/personal-qr')
@UseGuards(AdminAuthGuard)
export class AdminPersonalQrController {
  constructor(private readonly qrService: PersonalQrService) {}

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
}
