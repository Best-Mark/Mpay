import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TraceContext } from '../utils/trace-context';

export interface OpLogInput {
  operator?: string;
  operatorType?: 'ADMIN' | 'SYSTEM' | 'MERCHANT';
  module: string;
  action: string;
  targetId?: string;
  detail?: string;
  payload?: any;
  ip?: string;
  result?: 'SUCCESS' | 'FAILED';
}

/**
 * 操作日志：所有敏感操作必须留痕（需求 3.2.3 异常处理留痕 + 第 7 章操作日志查询）
 */
@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(input: OpLogInput): Promise<void> {
    try {
      await this.prisma.operationLog.create({
        data: {
          operator: input.operator || TraceContext.get()?.operator || 'SYSTEM',
          operatorType: input.operatorType || 'SYSTEM',
          module: input.module,
          action: input.action,
          targetId: input.targetId,
          detail: input.detail,
          payload: input.payload ?? undefined,
          ip: input.ip,
          result: input.result || 'SUCCESS',
        },
      });
    } catch (e) {
      // 日志写入失败绝不能影响主流程
      this.logger.error(`写操作日志失败: ${e.message}`);
    }
  }

  async list(params: {
    operator?: string;
    module?: string;
    action?: string;
    keyword?: string;
    startTime?: Date;
    endTime?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.operator) where.operator = { contains: params.operator };
    if (params.module) where.module = params.module;
    if (params.action) where.action = params.action;
    if (params.keyword) {
      where.OR = [
        { targetId: { contains: params.keyword } },
        { detail: { contains: params.keyword } },
      ];
    }
    if (params.startTime || params.endTime) {
      where.createdAt = {};
      if (params.startTime) where.createdAt.gte = params.startTime;
      if (params.endTime) where.createdAt.lte = params.endTime;
    }

    const [list, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.operationLog.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }
}
