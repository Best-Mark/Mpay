import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { SystemConfigService } from '../../common/config/system-config.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { CryptoUtil } from '../../common/utils/crypto.util';

export interface MailMessage {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

/** 验证码场景 */
export enum VerifyScene {
  REGISTER = 'REGISTER',
  RESET_PASSWORD = 'RESET_PASSWORD',
}

const CODE_TTL_MINUTES = 10;
/** 同一邮箱 60 秒内只能取一次验证码 */
const CODE_RESEND_INTERVAL = 60;

/**
 * 邮件服务
 *
 * SMTP 配置来自 system_config（后台「系统设置 → 邮件」），改完即生效，不必重启。
 * 关键约定：邮件是「尽力而为」的旁路能力 —— 除测试发信外，任何发送失败都只记日志，
 * 绝不能把主流程（下单/通知/对账/注册审核）拖垮。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  /** 当前 transporter 对应的配置指纹，配置变更时自动重建 */
  private transporterKey = '';

  constructor(
    private readonly cfg: SystemConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ==================== 发送基础 ====================

  private async getTransporter(override?: any): Promise<{ tx: Transporter; from: string }> {
    const c = override
      ? {
          host: override.host,
          port: Number(override.port) || 465,
          secure: override.secure === true || String(override.secure) === 'true',
          user: override.user,
          pass: override.pass,
          from: override.from || override.user,
          fromName: override.fromName || '统一支付中心',
        }
      : await this.cfg.getSmtpConfig();

    if (!c.host || !c.user || !c.pass) {
      throw new BizException(ErrorCode.MAIL_NOT_CONFIGURED);
    }

    const key = `${c.host}:${c.port}:${c.secure}:${c.user}:${CryptoUtil.sha256(c.pass)}`;
    if (!override && this.transporter && this.transporterKey === key) {
      return { tx: this.transporter, from: this.formatFrom(c.from, c.fromName) };
    }

    const tx = nodemailer.createTransport({
      host: c.host,
      port: Number(c.port) || 465,
      secure: !!c.secure,
      auth: { user: c.user, pass: c.pass },
      // 企业邮箱常见自签证书；生产环境建议保持校验证书
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    if (!override) {
      this.transporter = tx;
      this.transporterKey = key;
    }
    return { tx, from: this.formatFrom(c.from, c.fromName) };
  }

  private formatFrom(from: string, name: string): string {
    return name ? `"${name}" <${from}>` : from;
  }

  /** 发送邮件（失败抛错，由调用方决定是否容忍） */
  async send(msg: MailMessage): Promise<void> {
    const to = msg.to.filter(Boolean);
    if (!to.length) return;
    const { tx, from } = await this.getTransporter();
    await tx.sendMail({
      from,
      to: to.join(','),
      subject: msg.subject,
      text: msg.text,
      html: msg.html || (msg.text ? `<pre style="font-family:inherit">${msg.text}</pre>` : undefined),
    });
    this.logger.log(`邮件已发送：${msg.subject} → ${to.join(',')}`);
  }

  /** 后台「测试发信」：可用传入的临时配置验证，不污染线上 transporter */
  async test(override: any, to: string): Promise<{ ok: boolean; message: string }> {
    try {
      const { tx, from } = await this.getTransporter(override);
      await tx.verify();
      await tx.sendMail({
        from,
        to,
        subject: '【统一支付中心】邮件配置测试',
        text: `这是一封测试邮件。收到它说明 SMTP 配置正确。\n发送时间：${new Date().toLocaleString('zh-CN')}`,
        html: `<p>这是一封测试邮件。收到它说明 SMTP 配置正确。</p><p style="color:#888">发送时间：${new Date().toLocaleString('zh-CN')}</p>`,
      });
      return { ok: true, message: `测试邮件已发送至 ${to}` };
    } catch (e: any) {
      this.logger.warn(`测试发信失败: ${e.message}`);
      return { ok: false, message: this.humanize(e) };
    }
  }

  // ==================== 告警 ====================

  /**
   * 告警邮件：按 subject 做静默期去重，失败只记日志
   * @returns 是否真正发出
   */
  async alert(subject: string, text: string, silentKey?: string): Promise<boolean> {
    try {
      if (!(await this.cfg.smtpReady())) return false;
      const emails = await this.cfg.getAlertEmails();
      if (!emails.length) return false;

      const silentMinutes = await this.cfg.getNumber('alert.silentMinutes', 30);
      const key = `mail:alert:silent:${silentKey || CryptoUtil.md5(subject)}`;
      if (silentMinutes > 0) {
        const locked = await this.redis.setNx(key, '1', silentMinutes * 60);
        if (!locked) {
          this.logger.warn(`告警已静默（${silentMinutes} 分钟内不重复）: ${subject}`);
          return false;
        }
      }

      await this.send({ to: emails, subject, text });
      return true;
    } catch (e: any) {
      this.logger.error(`告警邮件发送失败: ${subject} - ${e.message}`);
      return false;
    }
  }

  // ==================== 邮箱验证码 ====================

  /** 发送注册/找回密码验证码；返回是否已发送（未配置邮件时为 false） */
  async sendVerifyCode(email: string, scene: VerifyScene, ip?: string): Promise<{ sent: boolean; message: string }> {
    const normalized = (email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '邮箱格式不正确');
    }

    // 频控：60 秒一次，防止被用来刷邮件
    const freqKey = `mail:code:freq:${normalized}:${scene}`;
    const exists = await this.redis.get(freqKey);
    if (exists) throw new BizException(ErrorCode.OPERATION_TOO_FREQUENT, '验证码已发送，请稍后再试');

    if (!(await this.cfg.smtpReady())) {
      return { sent: false, message: '邮件服务未配置，无法发送验证码，请联系管理员' };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expireAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    await this.prisma.emailVerifyCode.create({
      data: { email: normalized, scene, code, ip, expireAt },
    });
    await this.redis.set(freqKey, '1', CODE_RESEND_INTERVAL);

    await this.send({
      to: [normalized],
      subject: '【统一支付中心】邮箱验证码',
      text: `您的验证码是 ${code}，${CODE_TTL_MINUTES} 分钟内有效。如非本人操作请忽略。`,
      html: `<p>您的验证码是</p><p style="font-size:28px;font-weight:600;letter-spacing:6px">${code}</p><p style="color:#888">${CODE_TTL_MINUTES} 分钟内有效。如非本人操作请忽略。</p>`,
    });
    return { sent: true, message: '验证码已发送，请查收邮件' };
  }

  /** 校验验证码：通过后即作废，防止一只码被反复使用 */
  async checkVerifyCode(email: string, scene: VerifyScene, code: string): Promise<boolean> {
    const normalized = (email || '').trim().toLowerCase();
    const row = await this.prisma.emailVerifyCode.findFirst({
      where: { email: normalized, scene, used: false, expireAt: { gte: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new BizException(ErrorCode.VERIFY_CODE_EXPIRED);
    if (row.code !== (code || '').trim()) throw new BizException(ErrorCode.VERIFY_CODE_INVALID);
    await this.prisma.emailVerifyCode.update({ where: { id: row.id }, data: { used: true } });
    return true;
  }

  // ==================== 业务通知 ====================

  /** 商户审核通过：告知 AppId / AppSecret（密钥只在此邮件中出现一次） */
  async notifyMerchantApproved(to: string, companyName: string, appId: string, appSecret: string): Promise<void> {
    await this.send({
      to: [to],
      subject: '【统一支付中心】入驻审核已通过',
      text: `您好，${companyName} 的入驻申请已通过。\nAppId: ${appId}\nAppSecret: ${appSecret}\n请妥善保存 AppSecret，系统不再明文展示。`,
      html: `<p>您好，<b>${companyName}</b> 的入驻申请已通过。</p>
        <p>AppId：<code>${appId}</code><br/>AppSecret：<code>${appSecret}</code></p>
        <p style="color:#c00">请妥善保存 AppSecret，系统不再明文展示；泄露可在后台自助重置。</p>`,
    });
  }

  async notifyMerchantRejected(to: string, companyName: string, reason: string): Promise<void> {
    await this.send({
      to: [to],
      subject: '【统一支付中心】入驻审核未通过',
      text: `您好，${companyName} 的入驻申请未通过。原因：${reason || '未说明'}`,
    });
  }

  /** 新商户提交注册申请时通知平台管理员 */
  async notifyNewMerchantApply(to: string[], companyName: string, email: string): Promise<void> {
    if (!to.length) return;
    await this.send({
      to,
      subject: '【统一支付中心】新的商户入驻申请',
      text: `收到新的入驻申请：${companyName}（${email}），请登录管理后台审核。`,
    });
  }

  /** 把 nodemailer 的英文报错翻成人能看懂的提示 */
  private humanize(e: any): string {
    const msg = e?.message || String(e);
    if (/EAUTH|535|authentication/i.test(msg)) return 'SMTP 认证失败：请检查账号与授权码（注意是授权码而非登录密码）';
    if (/ECONNECTION|ETIMEDOUT|ESOCKET|connect/i.test(msg)) return `连接 SMTP 服务器失败：${msg}`;
    if (/ENOTFOUND|getaddrinfo/i.test(msg)) return 'SMTP 服务器地址无法解析，请检查 host';
    if (/certificate/i.test(msg)) return 'TLS 证书校验失败：可尝试切换 SSL/STARTTLS 或端口';
    return msg;
  }
}
