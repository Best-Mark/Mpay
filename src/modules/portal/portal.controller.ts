import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PortalService } from './portal.service';
import { MerchantAuthGuard, currentMerchant } from './merchant-auth.guard';

/**
 * 商户自助入驻开放接口（无需后台登录）
 * 注册开关由后台「系统设置 → 注册」控制，默认关闭
 */
@ApiTags('开放接口-商户入驻')
@Controller('api/portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('config')
  @ApiOperation({ summary: '入驻页公开配置（是否开放注册、是否需要验证码）' })
  async config() {
    return this.portal.publicConfig();
  }

  @Post('register/code')
  @ApiOperation({ summary: '发送注册邮箱验证码' })
  async sendCode(@Body() body: { email: string }, @Req() req: Request) {
    return this.portal.sendCode(body.email, (req.ip || '').replace('::ffff:', ''));
  }

  @Post('register')
  @ApiOperation({ summary: '提交入驻申请' })
  async register(@Body() body: any, @Req() req: Request) {
    return this.portal.register(body, (req.ip || '').replace('::ffff:', ''));
  }

  @Post('login')
  @ApiOperation({ summary: '商户登录' })
  async login(@Body() body: { email: string; password: string }, @Req() req: Request) {
    return this.portal.login(body.email, body.password, (req.ip || '').replace('::ffff:', ''));
  }

  @Get('me')
  @UseGuards(MerchantAuthGuard)
  @ApiOperation({ summary: '当前商户信息' })
  async me(@Req() req: Request) {
    return currentMerchant(req);
  }

  @Get('apps')
  @UseGuards(MerchantAuthGuard)
  @ApiOperation({ summary: '我的业务系统与密钥' })
  async apps(@Req() req: Request) {
    return this.portal.myApps(Number(currentMerchant(req).sub));
  }
}
