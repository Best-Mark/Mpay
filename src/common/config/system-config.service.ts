import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from '../log/operation-log.service';
import { CryptoUtil } from '../utils/crypto.util';

/**
 * 系统运行时配置
 *
 * 为什么要有这张表：
 *   数据库 / Redis / 端口 / 主密钥这类「改了必须重启」的项留在 .env；
 *   邮件、注册开关、告警阈值这类「随时想调」的项如果也写 .env，
 *   线上为了改一个 SMTP 端口就得重启收单进程，属于自找故障。
 *   故统一落库，后台改完即生效。
 *
 * 读取路径：进程内缓存（30s）→ 库 → 定义默认值 → 环境变量兜底
 * 敏感项（secret=true）AES 加密落库，对外接口只回显「是否已设置」，绝不回传明文
 */

export interface ConfigDef {
  key: string;
  group: string;
  label: string;
  /** 敏感项：加密存储，接口只回显是否已配置 */
  secret?: boolean;
  /** 库与环境变量都没有时的默认值 */
  default?: string;
  /** 环境变量兜底键（优先级：库 > 环境变量 > default） */
  env?: string;
  remark?: string;
}

export const CONFIG_DEFS: ConfigDef[] = [
  // ===== 邮件 =====
  { key: 'mail.enabled', group: 'mail', label: '启用邮件服务', default: 'false', remark: '关闭后不发送任何邮件（注册验证码、告警）' },
  { key: 'mail.host', group: 'mail', label: 'SMTP 服务器', env: 'SMTP_HOST', remark: '如 smtp.qq.com / smtp.exmail.qq.com' },
  { key: 'mail.port', group: 'mail', label: 'SMTP 端口', default: '465', env: 'SMTP_PORT', remark: '465=SSL，587=STARTTLS，25=明文' },
  { key: 'mail.secure', group: 'mail', label: '使用 SSL', default: 'true', env: 'SMTP_SECURE', remark: '465 填 true；587 填 false' },
  { key: 'mail.user', group: 'mail', label: 'SMTP 账号', env: 'SMTP_USER', remark: '通常为完整邮箱地址' },
  { key: 'mail.pass', group: 'mail', label: 'SMTP 密码/授权码', env: 'SMTP_PASS', secret: true, remark: '邮箱服务商生成的授权码，非登录密码' },
  { key: 'mail.from', group: 'mail', label: '发件人地址', env: 'SMTP_FROM', remark: '留空则使用 SMTP 账号' },
  { key: 'mail.fromName', group: 'mail', label: '发件人名称', default: '统一支付中心', env: 'SMTP_FROM_NAME' },

  // ===== 商户注册 =====
  { key: 'register.enabled', group: 'register', label: '开放商户自助注册', default: 'false', remark: '关闭时注册页直接拒绝提交' },
  { key: 'register.autoApprove', group: 'register', label: '注册后自动通过', default: 'false', remark: '开启后免去人工审核，直接开通业务系统' },
  { key: 'register.verifyEmail', group: 'register', label: '注册需邮箱验证码', default: 'true', remark: '关闭则无需验证码（不建议）' },
  { key: 'register.auditNotify', group: 'register', label: '审核结果邮件通知', default: 'true' },

  // ===== 告警 =====
  { key: 'alert.emails', group: 'alert', label: '告警收件人', env: 'ALERT_EMAILS', remark: '多个用英文逗号分隔' },
  { key: 'alert.notifyDeadLetter', group: 'alert', label: '通知死信告警', default: 'true', remark: '通知重试耗尽进入死信时发邮件' },
  { key: 'alert.reconcileDiff', group: 'alert', label: '对账差异告警', default: 'true' },
  { key: 'alert.diffThreshold', group: 'alert', label: '差异笔数阈值', default: '10', env: 'RECONCILE_DIFF_ALERT_THRESHOLD', remark: '达到该笔数即告警' },
  { key: 'alert.silentMinutes', group: 'alert', label: '同类告警静默期(分钟)', default: '30', remark: '防止故障期间刷屏' },
  { key: 'alert.personalQrUnmatched', group: 'alert', label: '个人码到账挂账告警', default: 'true', remark: '监控器上报但匹配不到订单时发邮件' },

  // ===== 个人收款码（到账监控）=====
  { key: 'personalQr.autoConfirm', group: 'personalQr', label: '到账自动确认', default: 'true', remark: '关闭后所有到账事件都需后台人工绑定确认' },
  { key: 'personalQr.matchWindowMinutes', group: 'personalQr', label: '匹配时间窗(分钟)', default: '30', remark: '只与「到账时刻前该时间窗内创建」的待付订单匹配' },
  { key: 'personalQr.uniqueAmount', group: 'personalQr', label: '唯一金额识别码', default: 'false', remark: '开启后应付金额=订单金额+0.01~0.90元识别码，到账金额即订单唯一键；代价是付款人多付几分钱' },
  { key: 'personalQr.textAmountRegex', group: 'personalQr', label: '到账文本金额正则', default: '', remark: '可选：通知/短信文案特殊时自定义抽取金额，第一个捕获组为金额，如 (\\d+\\.\\d{2})元' },

  // ===== 站点 =====
  { key: 'site.name', group: 'site', label: '站点名称', default: '统一支付中心', env: 'SITE_NAME' },
  { key: 'site.logo', group: 'site', label: '站点 Logo', env: 'SITE_LOGO', remark: '上传后自动填入访问路径' },
  { key: 'site.baseUrl', group: 'site', label: '对外访问地址', env: 'PAY_BASE_URL', remark: '渠道回调地址由它拼出' },
  { key: 'site.icp', group: 'site', label: '备案号', env: 'SITE_ICP' },
  { key: 'site.contactEmail', group: 'site', label: '联系邮箱', env: 'SITE_CONTACT_EMAIL' },
];

const DEF_MAP = new Map(CONFIG_DEFS.map((d) => [d.key, d]));

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

/** 后台设置页返回的配置项（敏感项不回传明文） */
export interface ConfigItemView {
  key: string;
  label: string;
  value: string;
  secret: boolean;
  /** 敏感项是否已配置（前端据此显示「已设置」） */
  hasValue: boolean;
  remark?: string;
}

@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);
  /** key → 明文值（含未落库的默认值与环境变量值） */
  private cache = new Map<string, string>();
  private loadedAt = 0;
  private readonly TTL = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly opLog: OperationLogService,
  ) {}

  // ==================== 读取 ====================

  /** 加载全表到缓存；DB 不可用时静默降级为「仅默认值 + 环境变量」 */
  private async ensureLoaded(force = false): Promise<void> {
    if (!force && this.cache.size && Date.now() - this.loadedAt < this.TTL) return;
    const next = new Map<string, string>();
    try {
      const rows = await this.prisma.systemConfig.findMany();
      for (const r of rows) {
        next.set(r.key, r.secret ? CryptoUtil.decrypt(r.value || '') : r.value || '');
      }
    } catch (e: any) {
      // 未安装 / 表不存在 / 库不可达：不能让配置读取拖垮主流程
      this.logger.warn(`读取系统配置失败，按默认值运行: ${e.message}`);
    }
    this.cache = next;
    this.loadedAt = Date.now();
  }

  /** 取值：库 > 环境变量 > 定义默认值 */
  async get(key: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const def = DEF_MAP.get(key);
    if (this.cache.has(key)) {
      const v = this.cache.get(key);
      if (v !== undefined && v !== '') return v;
    }
    if (def?.env && process.env[def.env]) return process.env[def.env];
    return def?.default;
  }

  async getString(key: string, fallback = ''): Promise<string> {
    return (await this.get(key)) ?? fallback;
  }

  async getNumber(key: string, fallback = 0): Promise<number> {
    const v = await this.get(key);
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBool(key: string, fallback = false): Promise<boolean> {
    const v = await this.get(key);
    if (v === undefined || v === '') return fallback;
    return v === 'true' || v === '1';
  }

  /** 取某一分组的全部配置（敏感项只回显是否已设置） */
  async getGroup(group: string): Promise<ConfigItemView[]> {
    await this.ensureLoaded();
    return CONFIG_DEFS.filter((d) => d.group === group).map((d) => {
      const raw = this.cache.get(d.key);
      const fromDb = raw !== undefined && raw !== '';
      const value = fromDb ? raw : (d.env && process.env[d.env]) || d.default || '';
      return {
        key: d.key,
        label: d.label,
        value: d.secret ? '' : value ?? '',
        secret: !!d.secret,
        hasValue: d.secret ? !!(value ?? '') : !!(value ?? ''),
        remark: d.remark,
      };
    });
  }

  /** 全部分组（后台设置页一次拉取） */
  async getAllGroups(): Promise<Record<string, ConfigItemView[]>> {
    const groups = ['mail', 'register', 'alert', 'personalQr', 'site'];
    const out: Record<string, ConfigItemView[]> = {};
    for (const g of groups) out[g] = await this.getGroup(g);
    return out;
  }

  // ==================== 写入 ====================

  /**
   * 批量保存（同一分组）。传 undefined 的键表示不改；
   * 敏感项传空字符串表示不修改（避免前端误清空）
   */
  async setMany(
    entries: Record<string, string | undefined>,
    operator: string,
    ip?: string,
  ): Promise<void> {
    const changed: { key: string; from: string; to: string }[] = [];
    for (const [key, raw] of Object.entries(entries)) {
      const def = DEF_MAP.get(key);
      if (!def) continue; // 只接受已定义的键，防止被写入任意配置
      if (raw === undefined) continue;
      const before = await this.get(key);
      if (def.secret && raw === '') continue; // 敏感项空值=不改
      const value = raw;
      if (before === value) continue;

      await this.prisma.systemConfig.upsert({
        where: { key },
        create: {
          key,
          group: def.group,
          value: def.secret ? CryptoUtil.encrypt(value) : value,
          secret: !!def.secret,
          remark: def.label,
          updatedBy: operator,
        },
        update: {
          value: def.secret ? CryptoUtil.encrypt(value) : value,
          updatedBy: operator,
        },
      });
      changed.push({ key, from: def.secret ? '***' : before ?? '', to: def.secret ? '***' : value });
    }

    await this.ensureLoaded(true);
    if (changed.length) {
      await this.opLog.write({
        operator,
        operatorType: 'ADMIN',
        module: 'system',
        action: 'update_config',
        detail: `更新系统配置 ${changed.length} 项`,
        payload: changed,
        ip,
      });
    }
  }

  // ==================== 业务语义封装 ====================

  async getSmtpConfig(): Promise<SmtpConfig> {
    const [enabled, host, port, secure, user, pass, from, fromName] = await Promise.all([
      this.getBool('mail.enabled', false),
      this.getString('mail.host'),
      this.getNumber('mail.port', 465),
      this.getBool('mail.secure', true),
      this.getString('mail.user'),
      this.getString('mail.pass'),
      this.getString('mail.from'),
      this.getString('mail.fromName', '统一支付中心'),
    ]);
    return { enabled, host, port, secure, user, pass, from: from || user, fromName };
  }

  async smtpReady(): Promise<boolean> {
    const c = await this.getSmtpConfig();
    return c.enabled && !!c.host && !!c.user && !!c.pass;
  }

  async getAlertEmails(): Promise<string[]> {
    const raw = await this.getString('alert.emails');
    return raw.split(/[,，;]/).map((s) => s.trim()).filter(Boolean);
  }

  async getDiffThreshold(): Promise<number> {
    return this.getNumber('alert.diffThreshold', 10);
  }

  async registerEnabled(): Promise<boolean> {
    return this.getBool('register.enabled', false);
  }

  async getSiteInfo(): Promise<{ name: string; logo: string; baseUrl: string; icp: string; contactEmail: string }> {
    const [name, logo, baseUrl, icp, contactEmail] = await Promise.all([
      this.getString('site.name', '统一支付中心'),
      this.getString('site.logo'),
      this.getString('site.baseUrl'),
      this.getString('site.icp'),
      this.getString('site.contactEmail'),
    ]);
    return { name, logo, baseUrl, icp, contactEmail };
  }
}
