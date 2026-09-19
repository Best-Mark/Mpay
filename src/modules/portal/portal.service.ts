import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SystemConfigService } from '../../common/config/system-config.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { PasswordUtil } from '../../common/utils/password.util';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { MailService, VerifyScene } from '../mail/mail.service';
import { MerchantService } from '../merchant/merchant.service';

export type MerchantStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'DISABLED';

export interface MerchantPrincipal {
  sub: string;
  email: string;
  companyName: string;
  type: 'MERCHANT';
}

const TOKEN_TTL_SECONDS = 12 * 3600;
const JWT_SECRET = () => process.env.MASTER_KEY || 'pay-center-jwt-secret';

/**
 * 商户自助入驻
 *
 * 流程：邮箱验证码 → 提交资料 → 后台审核（或按配置自动通过）→ 生成 AppId/AppSecret → 邮件告知密钥
 * 设计取舍：
 *   - 注册开关默认关闭，需超管在「系统设置 → 注册」显式开启（支付系统是资金入口，不能默认敞开）
 *   - 未配置 SMTP 时验证码发不出去，注册页面直接给出明确提示，而不是让人干等
 *   - AppSecret 只在「创建时」和「重置时」出现一次，邮件是交付渠道之一
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: SystemConfigService,
    private readonly mail: MailService,
    private readonly merchant: MerchantService,
    private readonly opLog: OperationLogService,
  ) {}

  // ==================== 开放信息 ====================

  async publicConfig() {
    const [enabled, needVerifyCode, site] = await Promise.all([
      this.cfg.registerEnabled(),
      this.cfg.getBool('register.verifyEmail', true),
      this.cfg.getSiteInfo(),
    ]);
    return {
      enabled,
      needVerifyCode,
      mailReady: await this.cfg.smtpReady(),
      siteName: site.name,
      logo: site.logo,
      contactEmail: site.contactEmail,
    };
  }

  // ==================== 注册 ====================

  async sendCode(email: string, ip?: string) {
    if (!(await this.cfg.registerEnabled())) {
      throw new BizException(ErrorCode.REGISTER_DISABLED);
    }
    return this.mail.sendVerifyCode(email, VerifyScene.REGISTER, ip);
  }

  async register(
    input: {
      email: string;
      password: string;
      companyName: string;
      contactName?: string;
      contactPhone?: string;
      website?: string;
      payNotifyUrl?: string;
      code?: string;
      remark?: string;
    },
    ip?: string,
  ) {
    if (!(await this.cfg.registerEnabled())) {
      throw new BizException(ErrorCode.REGISTER_DISABLED);
    }
    const email = (input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '邮箱格式不正确');
    }
    if (!input.password || input.password.length < 8) {
      throw new BizException(ErrorCode.PARAM_ERROR, '密码至少 8 位');
    }
    if (!input.companyName?.trim()) {
      throw new BizException(ErrorCode.PARAM_ERROR, '请填写公司/主体名称');
    }

    const exist = await this.prisma.merchantUser.findUnique({ where: { email } });
    if (exist && exist.status !== 'REJECTED') {
      throw new BizException(ErrorCode.MERCHANT_USER_EXISTS);
    }

    // 需要验证码时先校验（校验通过即作废该码）
    if (await this.cfg.getBool('register.verifyEmail', true)) {
      await this.mail.checkVerifyCode(email, VerifyScene.REGISTER, input.code || '');
    }

    const data = {
      email,
      passwordHash: PasswordUtil.hash(input.password),
      companyName: input.companyName.trim(),
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      website: input.website,
      payNotifyUrl: input.payNotifyUrl,
      remark: input.remark,
      status: 'PENDING' as MerchantStatus,
      emailVerifiedAt: new Date(),
    };

    let user;
    if (exist) {
      // 驳回后可重新提交：复用同一邮箱账号
      user = await this.prisma.merchantUser.update({
        where: { id: exist.id },
        data: { ...data, rejectReason: null, reviewedAt: null, reviewer: null },
      });
    } else {
      user = await this.prisma.merchantUser.create({ data });
    }

    await this.opLog.write({
      operator: email,
      operatorType: 'MERCHANT',
      module: 'portal',
      action: 'register',
      targetId: String(user.id),
      detail: `提交入驻申请：${data.companyName}`,
      ip,
    });

    // 通知平台管理员有新申请（失败不影响注册结果）
    const admins = await this.cfg.getAlertEmails();
    this.mail.notifyNewMerchantApply(admins, data.companyName, email).catch((e) => {
      this.logger.warn(`新商户申请通知邮件发送失败: ${e.message}`);
    });

    // 自动通过模式：直接开通业务系统
    if (await this.cfg.getBool('register.autoApprove', false)) {
      const approved = await this.approve(Number(user.id), {}, 'SYSTEM', ip);
      return {
        id: Number(user.id),
        status: 'ACTIVE' as MerchantStatus,
        needReview: false,
        appId: approved.appId,
        appSecret: approved.appSecret,
      };
    }

    return { id: Number(user.id), status: 'PENDING' as MerchantStatus, needReview: true };
  }

  // ==================== 审核（后台） ====================

  async list(params: { status?: string; keyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.keyword) {
      where.OR = [
        { email: { contains: params.keyword } },
        { companyName: { contains: params.keyword } },
        { contactName: { contains: params.keyword } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.merchantUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { apps: { select: { appId: true, name: true, enabled: true } } },
      }),
      this.prisma.merchantUser.count({ where }),
    ]);
    return {
      list: rows.map((r) => ({
        id: Number(r.id),
        email: r.email,
        companyName: r.companyName,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        website: r.website,
        status: r.status,
        rejectReason: r.rejectReason,
        reviewer: r.reviewer,
        reviewedAt: r.reviewedAt,
        lastLoginAt: r.lastLoginAt,
        remark: r.remark,
        createdAt: r.createdAt,
        apps: r.apps.map((a) => ({ appId: a.appId, name: a.name, enabled: a.enabled })),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 审核通过：为其开通业务系统（AppId/AppSecret）
   * 已开通过的账号重复通过只做启用，不重新下发密钥（避免密钥被反复重置）
   */
  async approve(
    id: number,
    input: { payNotifyUrl?: string; refundNotifyUrl?: string; allowChannels?: string[]; limitPerOrder?: number; remark?: string },
    operator: string,
    ip?: string,
  ): Promise<{ appId?: string; appSecret?: string }> {
    const user = await this.prisma.merchantUser.findUnique({
      where: { id: BigInt(id) },
      include: { apps: true },
    });
    if (!user) throw new BizException(ErrorCode.MERCHANT_USER_NOT_FOUND);

    let appId: string | undefined;
    let appSecret: string | undefined;

    if (user.apps?.length) {
      for (const app of user.apps) {
        await this.prisma.merchantApp.update({ where: { appId: app.appId }, data: { enabled: true } });
        this.merchant.invalidate(app.appId);
      }
      appId = user.apps[0].appId;
    } else {
      const payNotifyUrl = input.payNotifyUrl || user.payNotifyUrl || '';
      if (!payNotifyUrl) {
        throw new BizException(ErrorCode.PARAM_ERROR, '请填写支付结果通知地址（业务系统接收回调的地址）');
      }
      const created = await this.merchant.create({
        name: user.companyName,
        payNotifyUrl,
        refundNotifyUrl: input.refundNotifyUrl,
        allowChannels: input.allowChannels,
        limitPerOrder: input.limitPerOrder,
        remark: input.remark || `自助注册：${user.email}`,
        operator,
        ip,
        userId: user.id,
      });
      appId = created.appId;
      appSecret = created.appSecret;
    }

    await this.prisma.merchantUser.update({
      where: { id: BigInt(id) },
      data: { status: 'ACTIVE', reviewedAt: new Date(), reviewer: operator, rejectReason: null },
    });

    await this.opLog.write({
      operator,
      operatorType: operator === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      module: 'portal',
      action: 'approve',
      targetId: user.email,
      detail: `审核通过并开通业务系统 ${appId}`,
      ip,
    });

    // 邮件告知密钥（只在首次开通、有明文密钥时发送）
    if (appSecret && (await this.cfg.getBool('register.auditNotify', true))) {
      this.mail.notifyMerchantApproved(user.email, user.companyName, appId!, appSecret).catch((e) => {
        this.logger.warn(`审核通过通知邮件发送失败: ${e.message}`);
      });
    }
    return { appId, appSecret };
  }

  async reject(id: number, reason: string, operator: string, ip?: string) {
    const user = await this.prisma.merchantUser.findUnique({ where: { id: BigInt(id) } });
    if (!user) throw new BizException(ErrorCode.MERCHANT_USER_NOT_FOUND);
    await this.prisma.merchantUser.update({
      where: { id: BigInt(id) },
      data: { status: 'REJECTED', rejectReason: reason, reviewedAt: new Date(), reviewer: operator },
    });
    await this.opLog.write({
      operator,
      operatorType: 'ADMIN',
      module: 'portal',
      action: 'reject',
      targetId: user.email,
      detail: `驳回入驻申请：${reason || '未说明'}`,
      ip,
    });
    if (await this.cfg.getBool('register.auditNotify', true)) {
      this.mail.notifyMerchantRejected(user.email, user.companyName, reason).catch(() => undefined);
    }
    return { success: true };
  }

  async setStatus(id: number, status: MerchantStatus, operator: string, ip?: string) {
    if (!['ACTIVE', 'DISABLED'].includes(status)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '只能切换到启用/停用');
    }
    const user = await this.prisma.merchantUser.findUnique({
      where: { id: BigInt(id) },
      include: { apps: true },
    });
    if (!user) throw new BizException(ErrorCode.MERCHANT_USER_NOT_FOUND);
    await this.prisma.merchantUser.update({
      where: { id: BigInt(id) },
      data: { status, reviewedAt: new Date(), reviewer: operator },
    });
    // 停用商户要连带停用其业务系统，避免账号停了接口还在收款
    for (const app of user.apps || []) {
      await this.prisma.merchantApp.update({ where: { appId: app.appId }, data: { enabled: status === 'ACTIVE' } });
      this.merchant.invalidate(app.appId);
    }
    await this.opLog.write({
      operator,
      operatorType: 'ADMIN',
      module: 'portal',
      action: 'set_status',
      targetId: user.email,
      detail: `商户账号状态改为 ${status}`,
      ip,
    });
    return { success: true };
  }

  // ==================== 商户登录 ====================

  async login(email: string, password: string, ip?: string) {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.prisma.merchantUser.findUnique({ where: { email: normalized } });
    if (!user || !PasswordUtil.verify(password, user.passwordHash)) {
      await this.opLog.write({
        operator: normalized,
        operatorType: 'MERCHANT',
        module: 'portal',
        action: 'login',
        detail: '登录失败：邮箱或密码错误',
        ip,
        result: 'FAILED',
      });
      throw new BizException(ErrorCode.TOKEN_INVALID, '邮箱或密码错误');
    }
    if (user.status !== 'ACTIVE') {
      throw new BizException(
        ErrorCode.MERCHANT_STATUS_INVALID,
        user.status === 'PENDING' ? '账号正在审核中' : user.status === 'DISABLED' ? '账号已停用' : '账号审核未通过',
      );
    }

    await this.prisma.merchantUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    });
    await this.opLog.write({
      operator: normalized,
      operatorType: 'MERCHANT',
      module: 'portal',
      action: 'login',
      detail: '登录成功',
      ip,
    });

    const principal: MerchantPrincipal = {
      sub: String(user.id),
      email: user.email,
      companyName: user.companyName,
      type: 'MERCHANT',
    };
    return { token: this.signToken(principal), expiresIn: TOKEN_TTL_SECONDS, user: principal };
  }

  private b64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  signToken(p: MerchantPrincipal): string {
    const header = this.b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const body = this.b64url(JSON.stringify({ ...p, iat: now, exp: now + TOKEN_TTL_SECONDS }));
    const sig = this.b64url(crypto.createHmac('sha256', JWT_SECRET()).update(`${header}.${body}`).digest());
    return `${header}.${body}.${sig}`;
  }

  verifyToken(token: string): MerchantPrincipal | null {
    try {
      const [header, body, sig] = token.split('.');
      if (!header || !body || !sig) return null;
      const expected = this.b64url(crypto.createHmac('sha256', JWT_SECRET()).update(`${header}.${body}`).digest());
      if (expected !== sig) return null;
      const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
      if (payload.type !== 'MERCHANT') return null;
      if (payload.exp && payload.exp * 1000 < Date.now()) return null;
      return { sub: payload.sub, email: payload.email, companyName: payload.companyName, type: 'MERCHANT' };
    } catch {
      return null;
    }
  }

  /** 商户自己的应用与密钥（自己的密钥可以看，重置另走后台接口） */
  async myApps(userId: number) {
    const rows = await this.prisma.merchantApp.findMany({ where: { userId: BigInt(userId) } });
    const user = await this.prisma.merchantUser.findUnique({ where: { id: BigInt(userId) } });
    return {
      companyName: user?.companyName || '',
      email: user?.email || '',
      apps: rows.map((r) => ({
        appId: r.appId,
        name: r.name,
        payNotifyUrl: r.payNotifyUrl,
        refundNotifyUrl: r.refundNotifyUrl || undefined,
        enabled: r.enabled,
        // 自己的密钥可以看；泄露后在后台自助重置
        appSecret: CryptoUtil.decrypt(r.appSecret),
        createdAt: r.createdAt,
      })),
    };
  }
}
