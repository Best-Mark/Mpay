import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

export interface MerchantAppView {
  id: number;
  appId: string;
  name: string;
  payNotifyUrl: string;
  refundNotifyUrl?: string;
  ipWhitelist?: string;
  verifyNotifySign: boolean;
  allowChannels?: string[];
  limitPerOrder: string;
  enabled: boolean;
  remark?: string;
  /** 归属商户账号 ID（自助注册开通时有值） */
  userId?: number;
  createdAt: Date;
}

export interface MerchantAppSecret {
  appId: string;
  /** 明文 AppSecret，仅用于签名校验，绝不可对外输出 */
  appSecret: string;
  enabled: boolean;
  name: string;
  allowChannels?: string[];
  limitPerOrder: string;
  ipWhitelist?: string;
  verifyNotifySign: boolean;
}

/**
 * 业务系统（AppId）配置服务
 * AppSecret 在库中 AES 加密存储，读取时解密并做进程内短缓存（60s）降低 DB 压力
 */
@Injectable()
export class MerchantService {
  private readonly logger = new Logger(MerchantService.name);
  private readonly cache = new Map<string, { data: MerchantAppSecret; expireAt: number }>();
  private readonly CACHE_TTL = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly opLog: OperationLogService,
  ) {}

  /** 获取含密钥的实体（内部签名校验用） */
  async getSecret(appId: string): Promise<MerchantAppSecret> {
    const cached = this.cache.get(appId);
    if (cached && cached.expireAt > Date.now()) return cached.data;

    const row = await this.prisma.merchantApp.findUnique({ where: { appId } });
    if (!row) throw new BizException(ErrorCode.APP_ID_NOT_FOUND, `AppId ${appId} 不存在`);
    if (!row.enabled) throw new BizException(ErrorCode.APP_DISABLED);

    const data: MerchantAppSecret = {
      appId: row.appId,
      appSecret: CryptoUtil.decrypt(row.appSecret),
      enabled: row.enabled,
      name: row.name,
      allowChannels: (row.allowChannels as string[]) || undefined,
      limitPerOrder: row.limitPerOrder.toString(),
      ipWhitelist: row.ipWhitelist || undefined,
      verifyNotifySign: row.verifyNotifySign,
    };
    this.cache.set(appId, { data, expireAt: Date.now() + this.CACHE_TTL });
    return data;
  }

  /** 校验来源 IP 白名单（未配置则放行） */
  assertIpAllowed(app: MerchantAppSecret, ip: string): void {
    if (!app.ipWhitelist) return;
    const list = app.ipWhitelist.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    if (!list.includes(ip)) {
      throw new BizException(ErrorCode.IP_NOT_ALLOWED, `IP ${ip} 不在白名单`);
    }
  }

  /** 校验该业务系统是否允许使用某渠道 */
  assertChannelAllowed(app: MerchantAppSecret, channel: string): void {
    if (!app.allowChannels || app.allowChannels.length === 0) return;
    if (!app.allowChannels.includes(channel)) {
      throw new BizException(ErrorCode.CHANNEL_NOT_ALLOWED, `${app.appId} 未开通渠道 ${channel}`);
    }
  }

  invalidate(appId: string): void {
    this.cache.delete(appId);
  }

  // ================= 后台管理 =================

  async list(params: { keyword?: string; enabled?: boolean; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.keyword) {
      where.OR = [{ appId: { contains: params.keyword } }, { name: { contains: params.keyword } }];
    }
    if (params.enabled !== undefined) where.enabled = params.enabled;

    const [rows, total] = await Promise.all([
      this.prisma.merchantApp.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.merchantApp.count({ where }),
    ]);
    return { list: rows.map((r) => this.toView(r)), total, page, pageSize };
  }

  async detail(appId: string): Promise<MerchantAppView> {
    const row = await this.prisma.merchantApp.findUnique({ where: { appId } });
    if (!row) throw new BizException(ErrorCode.DATA_NOT_FOUND, '业务系统不存在');
    return this.toView(row);
  }

  async create(input: {
    name: string;
    payNotifyUrl: string;
    refundNotifyUrl?: string;
    ipWhitelist?: string;
    allowChannels?: string[];
    limitPerOrder?: number;
    remark?: string;
    operator: string;
    ip?: string;
    /** 归属商户账号（自助注册审核通过时绑定） */
    userId?: bigint;
  }) {
    // 生成 AppId / AppSecret：各 16 位随机
    const appId = `app_${CryptoUtil.randomString(16)}`;
    const appSecret = CryptoUtil.randomString(32);

    const row = await this.prisma.merchantApp.create({
      data: {
        appId,
        name: input.name,
        appSecret: CryptoUtil.encrypt(appSecret),
        payNotifyUrl: input.payNotifyUrl,
        refundNotifyUrl: input.refundNotifyUrl,
        ipWhitelist: input.ipWhitelist,
        allowChannels: input.allowChannels ?? undefined,
        limitPerOrder: input.limitPerOrder ?? 0,
        remark: input.remark,
        userId: input.userId,
      },
    });

    await this.opLog.write({
      operator: input.operator,
      operatorType: 'ADMIN',
      module: 'merchant',
      action: 'create',
      targetId: appId,
      detail: `创建业务系统「${input.name}」`,
      ip: input.ip,
    });

    // 仅在创建时明文返回一次，后续不再可得
    return { ...this.toView(row), appSecret };
  }

  async update(
    appId: string,
    input: {
      name?: string;
      payNotifyUrl?: string;
      refundNotifyUrl?: string;
      ipWhitelist?: string;
      allowChannels?: string[];
      limitPerOrder?: number;
      enabled?: boolean;
      remark?: string;
      operator: string;
      ip?: string;
    },
  ) {
    const row = await this.prisma.merchantApp.update({
      where: { appId },
      data: {
        name: input.name,
        payNotifyUrl: input.payNotifyUrl,
        refundNotifyUrl: input.refundNotifyUrl,
        ipWhitelist: input.ipWhitelist,
        allowChannels: input.allowChannels ?? undefined,
        limitPerOrder: input.limitPerOrder,
        enabled: input.enabled,
        remark: input.remark,
      },
    });
    this.invalidate(appId);
    await this.opLog.write({
      operator: input.operator,
      operatorType: 'ADMIN',
      module: 'merchant',
      action: 'update',
      targetId: appId,
      detail: `修改业务系统配置`,
      payload: input,
      ip: input.ip,
    });
    return this.toView(row);
  }

  /** 重置 AppSecret（密钥泄露时使用），明文仅返回一次 */
  async resetSecret(appId: string, operator: string, ip?: string) {
    const appSecret = CryptoUtil.randomString(32);
    await this.prisma.merchantApp.update({
      where: { appId },
      data: { appSecret: CryptoUtil.encrypt(appSecret) },
    });
    this.invalidate(appId);
    await this.opLog.write({
      operator,
      operatorType: 'ADMIN',
      module: 'merchant',
      action: 'reset_secret',
      targetId: appId,
      detail: '重置 AppSecret',
      ip,
    });
    return { appId, appSecret };
  }

  private toView(row: any): MerchantAppView {
    return {
      id: Number(row.id),
      appId: row.appId,
      name: row.name,
      payNotifyUrl: row.payNotifyUrl,
      refundNotifyUrl: row.refundNotifyUrl || undefined,
      ipWhitelist: row.ipWhitelist || undefined,
      verifyNotifySign: row.verifyNotifySign,
      allowChannels: (row.allowChannels as string[]) || undefined,
      limitPerOrder: row.limitPerOrder.toString(),
      enabled: row.enabled,
      remark: row.remark || undefined,
      userId: row.userId ? Number(row.userId) : undefined,
      createdAt: row.createdAt,
    };
  }
}
