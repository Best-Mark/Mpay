import { Body, Controller, Get, Post, Put, Param, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard, Roles, currentAdmin } from './admin-auth.guard';
import { AdminRole } from '../../common/constants/enums';

@ApiTags('管理后台-账号')
@Controller('api/admin')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @ApiOperation({ summary: '后台登录' })
  async login(@Body() body: { username: string; password: string }, @Req() req: Request) {
    const ip = (req.ip || '').replace('::ffff:', '');
    return this.auth.login(body.username, body.password, ip);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @ApiOperation({ summary: '当前登录信息' })
  async me(@Req() req: Request) {
    return this.auth.me(currentAdmin(req));
  }

  @Post('change-password')
  @UseGuards(AdminAuthGuard)
  @ApiOperation({ summary: '修改登录密码' })
  async changePassword(@Req() req: Request, @Body() body: { oldPassword: string; newPassword: string }) {
    const admin = currentAdmin(req);
    return this.auth.changePassword(admin.username, body.oldPassword, body.newPassword, (req.ip || '').replace('::ffff:', ''));
  }

  @Get('users')
  @UseGuards(AdminAuthGuard)
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '后台账号列表（仅超管）' })
  async users() {
    return this.auth.listUsers();
  }

  @Post('users')
  @UseGuards(AdminAuthGuard)
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '创建后台账号（仅超管）' })
  async createUser(@Req() req: Request, @Body() body: any) {
    return this.auth.createUser({
      ...body,
      operator: currentAdmin(req).username,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  @Put('users/:id')
  @UseGuards(AdminAuthGuard)
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '修改后台账号（仅超管）' })
  async updateUser(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    return this.auth.updateUser(Number(id), body, currentAdmin(req).username, (req.ip || '').replace('::ffff:', ''));
  }
}
