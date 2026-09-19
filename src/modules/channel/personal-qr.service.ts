import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

/**
 * 个人收款码管理（personal_qr 渠道）
 *
 * 面向没有商户号的用户：上传自己的微信 / 支付宝收款二维码即可收款。
 * 码按「业务系统 AppId」归属，一个系统可配多张（微信 / 支付宝）。
 */
@Injectable()
export class PersonalQrService {
  private readonly logger = new Logger(PersonalQrService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(params: { appId?: string; enabledOnly?: boolean } = {}) {
    const where: any = {};
    if (params.appId) where.appId = params.appId;
    if (params.enabledOnly) where.enabled = true;
    const rows = await this.prisma.personalQrCode.findMany({
      where,
      orderBy: [{ appId: 'asc' }, { type: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async create(input: { appId: string; type: string; name?: string; imageUrl: string; enabled?: boolean }, operator = 'SYSTEM') {
    const appId = (input.appId || '').trim();
    const type = (input.type || '').trim();
    const imageUrl = (input.imageUrl || '').trim();
    if (!appId) throw new BizException(ErrorCode.PARAM_ERROR, 'appId 必填');
    if (!['wechat', 'alipay', 'other'].includes(type)) {
      throw new BizException(ErrorCode.PARAM_ERROR, 'type 只能是 wechat / alipay / other');
    }
    if (!imageUrl) throw new BizException(ErrorCode.PARAM_ERROR, '请先上传收款码图片');

    const row = await this.prisma.personalQrCode.create({
      data: {
        appId,
        type,
        name: (input.name || `${appId}-${type}`).slice(0, 64),
        imageUrl,
        enabled: input.enabled ?? true,
      },
    });
    this.logger.log(`[personal-qr] 新增收款码 appId=${appId} type=${type} by=${operator}`);
    return this.toView(row);
  }

  async update(id: number, input: { type?: string; name?: string; imageUrl?: string; enabled?: boolean }) {
    const data: any = {};
    if (input.type !== undefined) {
      if (!['wechat', 'alipay', 'other'].includes(input.type)) {
        throw new BizException(ErrorCode.PARAM_ERROR, 'type 只能是 wechat / alipay / other');
      }
      data.type = input.type;
    }
    if (input.name !== undefined) data.name = input.name.slice(0, 64);
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    const row = await this.prisma.personalQrCode.update({ where: { id: BigInt(id) }, data });
    return this.toView(row);
  }

  async remove(id: number) {
    await this.prisma.personalQrCode.delete({ where: { id: BigInt(id) } });
    return { id };
  }

  /** 选码：优先指定类型，其次取该应用第一张启用码 */
  async pick(appId: string, type?: string) {
    const where: any = { appId, enabled: true };
    if (type) where.type = type;
    return this.prisma.personalQrCode.findFirst({
      where,
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
    });
  }

  /** 该应用全部启用中的收款码（收银台页按 type 分栏展示） */
  async pickAll(appId: string) {
    const rows = await this.prisma.personalQrCode.findMany({
      where: { appId, enabled: true },
      orderBy: [{ type: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({ type: r.type, name: r.name, imageUrl: r.imageUrl }));
  }

  private toView(r: any) {
    return {
      id: Number(r.id),
      appId: r.appId,
      type: r.type,
      name: r.name,
      imageUrl: r.imageUrl,
      enabled: r.enabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
