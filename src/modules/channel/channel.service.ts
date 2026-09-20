import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { Channel, CHANNEL_AUTO, BIZ_CATEGORY_LABEL } from '../../common/constants/enums';
import { SystemConfigService } from '../../common/config/system-config.service';
import { ChannelAdapter } from './channel.types';
import { MockAdapter } from './adapters/mock.adapter';
import { PersonalQrAdapter } from './adapters/personal-qr.adapter';
import { WechatAdapter } from './adapters/wechat.adapter';
import { AlipayAdapter } from './adapters/alipay.adapter';
import { UnionPayAdapter } from './adapters/unionpay.adapter';
import { AVAILABLE_CHANNELS, CHANNEL_META, validateChannelConfig } from './channel-meta';

/** 渠道选择范围：场景 + 法人主体 + 经营类目 */
export interface ChannelScope {
  scene?: string | null;
  legalEntityId?: bigint | number | null;
  category?: string | null;
}

/**
 * 单个渠道配置是否落在指定范围内
 *
 * 兼容存量：配置未归属主体（legalEntityId 为空）或未填类目时放行；
 * 一旦两边都有值就必须一致 —— 这条边界就是「跨主体收款＝二清」的硬防线。
 */
function matchScope(
  row: { scene?: string | null; legalEntityId?: bigint | null; categories?: unknown },
  scope: ChannelScope,
): boolean {
  const { scene, legalEntityId, category } = scope;
  if (scene && row.scene && row.scene !== scene) return false;
  if (legalEntityId != null && row.legalEntityId != null && row.legalEntityId !== BigInt(legalEntityId)) {
    return false;
  }
  if (category) {
    const cats = Array.isArray(row.categories) ? (row.categories as string[]) : [];
    if (cats.length > 0 && !cats.includes(category)) return false;
  }
  return true;
}

/**
 * 渠道工厂：根据渠道 + 场景选出可用配置，构造适配器
 * 新增渠道只需在此处增加一个 case，业务代码零感知
 */
@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);
  private readonly cache = new Map<string, { adapter: ChannelAdapter; expireAt: number }>();
  private readonly CACHE_TTL = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly opLog: OperationLogService,
    private readonly cfg: SystemConfigService,
  ) {}

  /**
   * 渠道路由：把「业务系统请求的渠道」解析为真正要走的渠道
   *
   * 规则：
   *  1. 显式指定（非 auto）→ 采用，但必须满足「已开通渠道 ∩ 同主体 ∩ 类目已报备」
   *  2. auto / 不传 → 按上述条件 + 场景匹配，取 priority 最高的配置
   *
   * 主体与类目是合规硬约束：跨主体收款＝无证二次清算（二清）。
   * 校验放在路由层而不是靠人工配置，误配就不可能发生。
   *
   * 设计目的：新增渠道只需在后台配置 + 服务端接入适配器，业务系统 / SDK 无需升级改造。
   */
  async resolveChannel(params: {
    requested?: string | null;
    allowChannels?: string[] | null;
    scene?: string | null;
    legalEntityId?: bigint | number | null;
    category?: string | null;
  }): Promise<string> {
    const { requested, allowChannels, scene, legalEntityId, category } = params;
    const allow = allowChannels && allowChannels.length ? allowChannels : null;
    const scope: ChannelScope = { scene, legalEntityId, category };

    if (requested && requested !== CHANNEL_AUTO) {
      if (allow && !allow.includes(requested)) {
        throw new BizException(ErrorCode.CHANNEL_NOT_ALLOWED, `应用未开通渠道 ${requested}`);
      }
      // 显式指定同样要过主体 / 类目校验，否则「手动指定渠道」就能绕过隔离
      if (!(await this.hasScopedConfig(requested, scope))) {
        throw new BizException(
          ErrorCode.CHANNEL_NOT_ALLOWED,
          `渠道 ${requested} 下没有匹配该主体${category ? `与类目「${BIZ_CATEGORY_LABEL[category] || category}」` : ''}的商户号`,
        );
      }
      return requested;
    }

    // 沙箱模式下自动路由直接落 Mock，避免选到「已配置但未联调」的真实渠道
    if ((process.env.DEFAULT_CHANNEL_MODE || 'sandbox') === 'sandbox') return Channel.MOCK;

    const rows = await this.prisma.channelConfig.findMany({
      where: { enabled: true },
      orderBy: { priority: 'desc' },
    });
    const hit = rows
      .filter((r) => AVAILABLE_CHANNELS.includes(r.channel))
      .filter((r) => !allow || allow.includes(r.channel))
      .filter((r) => matchScope(r, scope))[0];

    if (!hit) {
      throw new BizException(
        ErrorCode.CHANNEL_NOT_FOUND,
        '暂无可用支付渠道：请确认后台已配置并启用渠道（或联系平台为应用开通渠道）',
      );
    }
    return hit.channel;
  }

  /** 该渠道下是否存在满足「场景 + 主体 + 类目」的可用配置（显式指定渠道时的合规校验） */
  private async hasScopedConfig(channel: string, scope: ChannelScope): Promise<boolean> {
    const rows = await this.prisma.channelConfig.findMany({ where: { channel, enabled: true } });
    return rows.some((r) => matchScope(r, scope));
  }

  /** 列出该应用可下单的渠道（供业务系统动态渲染收银台，不必写死在 SDK 里） */
  listRoutableChannels(allowChannels?: string[] | null): { channel: string; label: string; scenes: string[] }[] {
    const allow = allowChannels && allowChannels.length ? allowChannels : null;
    return AVAILABLE_CHANNELS.filter((c) => !allow || allow.includes(c)).map((c) => ({
      channel: c,
      label: CHANNEL_META[c]?.label || c,
      scenes: CHANNEL_META[c]?.scenes || [],
    }));
  }

  /**
   * 获取渠道适配器
   * 安全策略：DEFAULT_CHANNEL_MODE=sandbox 时强制使用 Mock，避免未配置密钥时误触真实资金
   */
  async getAdapter(channel: string, scene?: string, scope?: ChannelScope): Promise<ChannelAdapter> {
    // 个人收款码不涉及渠道密钥与资金 API，沙箱模式下也走真实适配器（便于联调展示与到账监控）
    if (channel === Channel.PERSONAL_QR) {
      return new PersonalQrAdapter('PERSONAL_QR', this.prisma, this.cfg);
    }

    const forceMock = (process.env.DEFAULT_CHANNEL_MODE || 'sandbox') === 'sandbox';
    if (forceMock && channel !== Channel.MOCK) {
      this.logger.debug(`sandbox 模式下渠道 ${channel} 由 Mock 适配器代理`);
      return new MockAdapter('MOCK_MCH_001', this.prisma);
    }

    // 缓存键必须含主体与类目：否则多主体并存时会命中别的主体缓存，串到错误商户号
    const cacheKey = `${channel}:${scene || ''}:${scope?.legalEntityId ?? ''}:${scope?.category ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expireAt > Date.now()) return cached.adapter;

    const rows = await this.prisma.channelConfig.findMany({
      where: {
        channel,
        enabled: true,
        ...(scene ? { scene } : {}),
        ...(scope?.legalEntityId != null ? { legalEntityId: BigInt(scope.legalEntityId) } : {}),
      },
      orderBy: { priority: 'desc' },
    });
    // 主体 / 类目过滤：确保最终拿到的是本主体已报备类目下的商户号
    const cfg = rows.filter((r) => matchScope(r, scope || {}))[0];
    if (!cfg) throw new BizException(ErrorCode.CHANNEL_NOT_FOUND, `渠道 ${channel} 无可用配置`);
    if (channel === Channel.PERSONAL_QR) return new PersonalQrAdapter(cfg.mchId, this.prisma, this.cfg);
    if (cfg.isSandbox) return new MockAdapter(cfg.mchId, this.prisma);

    const adapter = this.build(channel, cfg);
    this.cache.set(cacheKey, { adapter, expireAt: Date.now() + this.CACHE_TTL });
    return adapter;
  }

  /**
   * 按业务系统取适配器：自动带上该 AppId 的主体与类目约束
   *
   * 退款 / 订单查询 / 关单都必须走这里，不能只用渠道名取适配器 ——
   * 多主体并存时只按渠道取会拿到别的主体商户号，签名不匹配直接失败。
   */
  async getAdapterForApp(channel: string, appId: string, scene?: string): Promise<ChannelAdapter> {
    const app = await this.prisma.merchantApp.findUnique({
      where: { appId },
      select: { legalEntityId: true, category: true },
    });
    return this.getAdapter(channel, scene, {
      legalEntityId: app?.legalEntityId ?? null,
      category: app?.category ?? null,
    });
  }

  /**
   * 取某渠道下所有启用的适配器（按优先级）
   *
   * 回调验签专用：通知到达时还不知道属于哪个主体，只能逐个尝试验签。
   * 只试默认配置会让非默认商户号的回调全部验签失败 ——
   * 后果是「用户已付款、订单不置成功」，属严重故障。
   */
  async getAdapters(channel: string): Promise<ChannelAdapter[]> {
    if (channel === Channel.PERSONAL_QR) {
      return [new PersonalQrAdapter('PERSONAL_QR', this.prisma, this.cfg)];
    }
    const forceMock = (process.env.DEFAULT_CHANNEL_MODE || 'sandbox') === 'sandbox';
    if (forceMock && channel !== Channel.MOCK) return [new MockAdapter('MOCK_MCH_001', this.prisma)];

    const rows = await this.prisma.channelConfig.findMany({
      where: { channel, enabled: true },
      orderBy: { priority: 'desc' },
    });
    const out: ChannelAdapter[] = [];
    for (const cfg of rows) {
      try {
        out.push(cfg.isSandbox ? new MockAdapter(cfg.mchId, this.prisma) : this.build(channel, cfg));
      } catch (e: any) {
        this.logger.warn(`[channel] ${channel}/${cfg.mchId} 构造适配器失败: ${e.message}`);
      }
    }
    return out;
  }

  /** 按渠道 + 商户号取适配器（账单上传归属指定商户号时用） */
  async getAdapterByMchId(channel: string, mchId: string): Promise<ChannelAdapter> {
    const cfg = await this.prisma.channelConfig.findFirst({
      where: { channel, mchId, enabled: true },
      orderBy: { priority: 'desc' },
    });
    if (!cfg) throw new BizException(ErrorCode.CHANNEL_NOT_FOUND, `渠道 ${channel} 下无商户号 ${mchId} 的可用配置`);
    return this.getAdapterByConfigId(cfg.id);
  }

  /**
   * 按配置 ID 精确取适配器（账单遍历专用）
   *
   * 不能用 getAdapter(channel)：它按 priority 只取该渠道「默认」商户号。
   * 主体隔离后同一渠道会挂多个商户号（不同主体 / 不同类目），只拉默认号的账单
   * 意味着其余主体的账永远没对过 —— 表面"对账通过"，实际漏了对账，属严重故障。
   */
  async getAdapterByConfigId(configId: bigint | number): Promise<ChannelAdapter> {
    const cfg = await this.prisma.channelConfig.findUnique({ where: { id: BigInt(configId) } });
    if (!cfg) throw new BizException(ErrorCode.CHANNEL_NOT_FOUND, `渠道配置 ${configId} 不存在`);

    const cacheKey = `cfg:${cfg.id}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expireAt > Date.now()) return cached.adapter;

    if (cfg.channel === Channel.PERSONAL_QR) return new PersonalQrAdapter(cfg.mchId, this.prisma, this.cfg);

    const forceMock = (process.env.DEFAULT_CHANNEL_MODE || 'sandbox') === 'sandbox';
    if (forceMock && cfg.channel !== Channel.MOCK) return new MockAdapter(cfg.mchId, this.prisma);
    if (cfg.isSandbox) return new MockAdapter(cfg.mchId, this.prisma);

    const adapter = this.build(cfg.channel, cfg);
    this.cache.set(cacheKey, { adapter, expireAt: Date.now() + this.CACHE_TTL });
    return adapter;
  }

  private build(channel: string, cfg: any): ChannelAdapter {
    const dec = (v?: string | null) => (v ? CryptoUtil.decrypt(v) : undefined);
    switch (channel) {
      case Channel.WECHAT:
        return new WechatAdapter({
          mchId: cfg.mchId,
          appid: cfg.channelAppId,
          serialNo: cfg.certSerialNo,
          apiV3Key: dec(cfg.apiV3Key),
          privateKey: dec(cfg.privateKey),
          platformCert: dec(cfg.platformCert),
          isSandbox: cfg.isSandbox,
        });
      case Channel.ALIPAY:
        return new AlipayAdapter({
          mchId: cfg.mchId,
          appid: cfg.channelAppId,
          privateKey: dec(cfg.privateKey),
          platformCert: dec(cfg.platformCert),
          isSandbox: cfg.isSandbox,
        });
      case Channel.UNIONPAY:
        return new UnionPayAdapter({
          mchId: cfg.mchId,
          certSerialNo: cfg.certSerialNo,
          privateKey: dec(cfg.privateKey),
          platformCert: dec(cfg.platformCert),
          isSandbox: cfg.isSandbox,
          extra: cfg.extra,
        });
      case Channel.MOCK:
        return new MockAdapter(cfg.mchId, this.prisma);
      default:
        throw new BizException(ErrorCode.CHANNEL_NOT_FOUND, `暂不支持的渠道: ${channel}`);
    }
  }

  invalidateCache(channel?: string): void {
    if (channel) {
      for (const k of [...this.cache.keys()]) {
        if (k.startsWith(`${channel}:`)) this.cache.delete(k);
      }
    } else {
      this.cache.clear();
    }
  }

  // ==================== 后台管理：渠道配置 ====================

  async listConfigs() {
    const rows = await this.prisma.channelConfig.findMany({ orderBy: [{ channel: 'asc' }, { priority: 'desc' }] });
    // 私钥等敏感字段一律不下发前端
    return rows.map((r) => ({
      id: Number(r.id),
      channel: r.channel,
      name: r.name,
      mchId: r.mchId,
      subMchId: r.subMchId,
      channelAppId: r.channelAppId,
      scene: r.scene,
      isSandbox: r.isSandbox,
      enabled: r.enabled,
      priority: r.priority,
      certSerialNo: r.certSerialNo,
      signType: r.signType,
      notifyUrl: r.notifyUrl,
      hasPrivateKey: !!r.privateKey,
      hasPlatformCert: !!r.platformCert,
      hasApiV3Key: !!r.apiV3Key,
      legalEntityId: r.legalEntityId ? Number(r.legalEntityId) : null,
      categories: (r.categories as string[]) || [],
      remark: r.remark,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async createConfig(input: {
    channel: string;
    name: string;
    mchId: string;
    subMchId?: string;
    channelAppId?: string;
    scene?: string;
    isSandbox?: boolean;
    priority?: number;
    privateKey?: string;
    platformCert?: string;
    certSerialNo?: string;
    apiV3Key?: string;
    signType?: string;
    notifyUrl?: string;
    /** 归属法人主体 ID */
    legalEntityId?: number;
    /** 该商户号已报备的经营类目 */
    categories?: string[];
    remark?: string;
    operator: string;
    ip?: string;
  }) {
    // 按渠道校验参数合理性（商户号/AppId 格式、必填密钥、场景支持）
    validateChannelConfig(input.channel, input, true);
    const row = await this.prisma.channelConfig.create({
      data: {
        channel: input.channel,
        name: input.name,
        mchId: input.mchId,
        subMchId: input.subMchId,
        channelAppId: input.channelAppId,
        scene: input.scene,
        isSandbox: input.isSandbox ?? true,
        priority: input.priority ?? 0,
        privateKey: input.privateKey ? CryptoUtil.encrypt(input.privateKey) : null,
        platformCert: input.platformCert ? CryptoUtil.encrypt(input.platformCert) : null,
        certSerialNo: input.certSerialNo,
        apiV3Key: input.apiV3Key ? CryptoUtil.encrypt(input.apiV3Key) : null,
        signType: input.signType,
        notifyUrl: input.notifyUrl || this.defaultNotifyUrl(input.channel),
        legalEntityId: input.legalEntityId ? BigInt(input.legalEntityId) : null,
        categories: input.categories ?? undefined,
        remark: input.remark,
      },
    });
    this.invalidateCache(input.channel);
    await this.opLog.write({
      operator: input.operator,
      operatorType: 'ADMIN',
      module: 'channel',
      action: 'create',
      targetId: `${input.channel}/${input.mchId}`,
      detail: `新增渠道配置「${input.name}」`,
      ip: input.ip,
    });
    return { id: Number(row.id) };
  }

  async updateConfig(
    id: number,
    input: {
      name?: string;
      channelAppId?: string;
      scene?: string;
      isSandbox?: boolean;
      enabled?: boolean;
      priority?: number;
      privateKey?: string;
      platformCert?: string;
      certSerialNo?: string;
      apiV3Key?: string;
      signType?: string;
      notifyUrl?: string;
      legalEntityId?: number;
      categories?: string[];
      remark?: string;
      operator: string;
      ip?: string;
    },
  ) {
    const cur = await this.prisma.channelConfig.findUnique({ where: { id: BigInt(id) } });
    if (!cur) throw new BizException(ErrorCode.DATA_NOT_FOUND, '渠道配置不存在');

    // 编辑时只校验「本次有改动」的字段（密钥留空 = 沿用库里已存内容，不做必填拦截）
    validateChannelConfig(cur.channel, input, false);

    await this.prisma.channelConfig.update({
      where: { id: BigInt(id) },
      data: {
        name: input.name,
        channelAppId: input.channelAppId,
        scene: input.scene,
        isSandbox: input.isSandbox,
        enabled: input.enabled,
        priority: input.priority,
        privateKey: input.privateKey ? CryptoUtil.encrypt(input.privateKey) : undefined,
        platformCert: input.platformCert ? CryptoUtil.encrypt(input.platformCert) : undefined,
        certSerialNo: input.certSerialNo,
        apiV3Key: input.apiV3Key ? CryptoUtil.encrypt(input.apiV3Key) : undefined,
        signType: input.signType,
        notifyUrl: input.notifyUrl,
        ...(input.legalEntityId !== undefined
          ? { legalEntityId: input.legalEntityId ? BigInt(input.legalEntityId) : null }
          : {}),
        categories: input.categories,
        remark: input.remark,
      },
    });
    this.invalidateCache(cur.channel);
    await this.opLog.write({
      operator: input.operator,
      operatorType: 'ADMIN',
      module: 'channel',
      action: 'update',
      targetId: `${cur.channel}/${cur.mchId}`,
      detail: `修改渠道配置（敏感字段${input.privateKey || input.apiV3Key ? '已更新' : '未变'}）`,
      ip: input.ip,
    });
    return { id };
  }

  /** 渠道异步回调地址：/api/v1/notify/{channel}/pay */
  defaultNotifyUrl(channel: string): string {
    const base = process.env.PAY_BASE_URL || '';
    return `${base}/api/v1/notify/${channel}/pay`;
  }
}
