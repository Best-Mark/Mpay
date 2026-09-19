import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SystemConfigService } from '../../common/config/system-config.service';
import { MailService } from '../mail/mail.service';
import { AdminAuthGuard, Roles, currentAdmin } from './admin-auth.guard';
import { AdminRole } from '../../common/constants/enums';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

/**
 * 系统设置（邮件 / 注册 / 告警 / 站点）
 *
 * 设计要点：配置落库而非写 .env —— 改 SMTP 端口这类操作不该让收单进程重启。
 * 敏感项（SMTP 密码）只回显「是否已设置」，保存时传空表示不修改。
 */
@ApiTags('管理后台-系统设置')
@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminSettingsController {
  constructor(
    private readonly cfg: SystemConfigService,
    private readonly mail: MailService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: '读取系统设置（按分组）' })
  async settings() {
    const [groups, smtpReady] = await Promise.all([this.cfg.getAllGroups(), this.cfg.smtpReady()]);
    return { groups, smtpReady };
  }

  @Put('settings')
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '保存系统设置（仅超管）' })
  async save(@Req() req: Request, @Body() body: { group?: string; values: Record<string, string> }) {
    if (!body?.values || typeof body.values !== 'object') {
      throw new BizException(ErrorCode.PARAM_ERROR, '缺少配置内容');
    }
    await this.cfg.setMany(body.values, currentAdmin(req).username, (req.ip || '').replace('::ffff:', ''));
    return { success: true };
  }

  /**
   * 测试发信
   * 传入 SMTP 字段时按「未保存的临时配置」验证（方便先试再存）；
   * 不传则直接用当前已保存配置发一封测试邮件
   */
  @Post('settings/mail/test')
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '测试 SMTP 配置（发送一封测试邮件）' })
  async testMail(@Body() body: any) {
    const to = (body?.to || '').trim();
    if (!to) throw new BizException(ErrorCode.PARAM_ERROR, '请填写收件邮箱');
    const hasOverride = !!(body?.host && body?.user && body?.pass);
    return this.mail.test(hasOverride ? body : undefined, to);
  }

  /** 告警链路自检：按当前配置给全部告警收件人发一封 */
  @Post('settings/alert/test')
  @Roles(AdminRole.SUPER)
  @ApiOperation({ summary: '发送测试告警邮件' })
  async testAlert() {
    const emails = await this.cfg.getAlertEmails();
    if (!emails.length) throw new BizException(ErrorCode.PARAM_ERROR, '请先在告警配置中填写收件人');
    const sent = await this.mail.alert(
      '【统一支付中心】告警测试',
      `这是一封告警测试邮件，收到说明告警链路正常。\n时间：${new Date().toLocaleString('zh-CN')}`,
      `test-${Date.now()}`,
    );
    if (!sent) throw new BizException(ErrorCode.MAIL_SEND_FAILED, '发送失败，请检查 SMTP 配置与收件人');
    return { success: true, to: emails };
  }
}
