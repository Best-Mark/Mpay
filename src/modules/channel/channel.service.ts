import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { Channel } from '../../common/constants/enums';
import { ChannelAdapter } from './channel.types';
import { MockAdapter } from './adapters/mock.adapter';
import { WechatAdapter } from './adapters/wechat.adapter';
import { AlipayAdapter } from './adapters/alipay.adapter';
import { UnionPayAdapter } from './adapters/unionpay.adapter';
import { validateChannelConfig } from './channel-meta';

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
  ) {}

  /**
   * 获取渠道适配器
   * 安全策略：DEFAULT_CHANNEL_MODE=sandbox 时强制使用 Mock，避免未配置密钥时误触真实资金
   */
  async getAdapter(channel: string, scene?: string): Promise<ChannelAdapter> {
    const forceMock = (process.env.DEFAULT_CHANNEL_MODE || 'sandbox') === 'sandbox';
    if (forceMock && channel !== Channel.MOCK) {
      this.logger.debug(`sandbox 模式下渠道 ${channel} 由 Mock 适配器代理`);
      return new MockAdapter('MOCK_MCH_001', this.prisma);
    }

    const cacheKey = `${channel}:${scene || ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expireAt > Date.now()) return cached.adapter;

    const rows = await this.prisma.channelConfig.findMany({
      where: { channel, enabled: true, ...(scene ? { scene } : {}) },
      orderBy: { priority: 'desc' },
    });
    if (!rows.length) throw new BizException(ErrorCode.CHANNEL_NOT_FOUND, `渠道 ${channel} 无可用配置`);

    const cfg = rows[0];
    if (cfg.isSandbox) return new MockAdapter(cfg.mchId, this.prisma);

    const adapter = this.build(channel, cfg);
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
