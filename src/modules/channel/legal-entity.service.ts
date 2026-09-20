import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

/**
 * 法人主体（LegalEntity）
 *
 * 收款合规的基础维度：一个商户号只能归属一个主体，业务系统只能路由到同主体的商户号。
 * 跨主体收款＝无证二次清算（二清），所以归属关系一旦建立，路由层会硬拒绝跨主体组合，
 * 而不是指望配置的人记得住。
 */
@Injectable()
export class LegalEntityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opLog: OperationLogService,
  ) {}

  async list(keyword?: string) {
    const where: any = {};
    if (keyword) {
      where.OR = [{ name: { contains: keyword } }, { unifiedCode: { contains: keyword } }];
    }
    const rows = await this.prisma.legalEntity.findMany({
      where,
      orderBy: [{ enabled: 'desc' }, { id: 'asc' }],
      include: { _count: { select: { apps: true, channels: true } } },
    });
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      unifiedCode: r.unifiedCode || '',
      contact: r.contact || '',
      remark: r.remark || '',
      enabled: r.enabled,
      appCount: r._count.apps,
      channelCount: r._count.channels,
      createdAt: r.createdAt,
    }));
  }

  async create(input: {
    name: string;
    unifiedCode?: string;
    contact?: string;
    remark?: string;
    operator: string;
    ip?: string;
  }) {
    const name = String(input.name || '').trim();
    if (!name) throw new BizException(ErrorCode.PARAM_ERROR, '主体名称必填');

    const row = await this.prisma.legalEntity.create({
      data: {
        name,
        unifiedCode: input.unifiedCode?.trim() || null,
        contact: input.contact?.trim() || null,
        remark: input.remark?.trim() || null,
      },
    });

    await this.opLog.write({
      operator: input.operator,
      operatorType: 'ADMIN',
      module: 'legal_entity',
      action: 'create',
      targetId: String(row.id),
      detail: `新增法人主体「${name}」`,
      ip: input.ip,
    });
    return { id: Number(row.id) };
  }

  async update(
    id: number,
    input: {
      name?: string;
      unifiedCode?: string;
      contact?: string;
      remark?: string;
      enabled?: boolean;
      operator: string;
      ip?: string;
    },
  ) {
    const row = await this.prisma.legalEntity.update({
      where: { id: BigInt(id) },
      data: {
        name: input.name?.trim(),
        unifiedCode: input.unifiedCode?.trim() || null,
        contact: input.contact?.trim() || null,
        remark: input.remark?.trim() || null,
        enabled: input.enabled,
      },
    });
    await this.opLog.write({
      operator: input.operator,
      operatorType: 'ADMIN',
      module: 'legal_entity',
      action: 'update',
      targetId: String(id),
      detail: `修改法人主体「${row.name}」`,
      payload: input,
      ip: input.ip,
    });
    return { id };
  }

  /** 删除：仍被业务系统或渠道配置引用时拒绝（避免主体消失导致路由无解） */
  async remove(id: number, operator: string, ip?: string) {
    const row = await this.prisma.legalEntity.findUnique({
      where: { id: BigInt(id) },
      include: { _count: { select: { apps: true, channels: true } } },
    });
    if (!row) throw new BizException(ErrorCode.DATA_NOT_FOUND, '法人主体不存在');
    if (row._count.apps > 0 || row._count.channels > 0) {
      throw new BizException(
        ErrorCode.PARAM_ERROR,
        `该主体下还有 ${row._count.apps} 个业务系统 / ${row._count.channels} 条渠道配置，请先改归属再删除`,
      );
    }

    await this.prisma.legalEntity.delete({ where: { id: BigInt(id) } });
    await this.opLog.write({
      operator,
      operatorType: 'ADMIN',
      module: 'legal_entity',
      action: 'delete',
      targetId: String(id),
      detail: `删除法人主体「${row.name}」`,
      ip,
    });
    return { id };
  }
}
