import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import dayjs from 'dayjs';
import { NotifyService } from '../notify/notify.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminAuthGuard, currentAdmin } from './admin-auth.guard';
import { Money } from '../../common/utils/money';
import { PayOrderStatus } from '../../common/constants/enums';

@ApiTags('管理后台-系统与监控')
@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminSystemController {
  constructor(
    private readonly notifyService: NotifyService,
    private readonly opLog: OperationLogService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: '首页概览：今日交易、成功率、待处理差异、通知失败数' })
  async dashboard() {
    const todayStart = dayjs().startOf('day').toDate();
    const todayEnd = dayjs().endOf('day').toDate();

    const [totalToday, successToday, amountAgg, pendingDiff, deadNotify, runningTask] = await Promise.all([
      this.prisma.payOrder.count({ where: { createdAt: { gte: todayStart, lte: todayEnd } } }),
      this.prisma.payOrder.count({
        where: {
          createdAt: { gte: todayStart, lte: todayEnd },
          status: { in: [PayOrderStatus.SUCCESS, PayOrderStatus.REFUNDING, PayOrderStatus.REFUNDED] },
        },
      }),
      this.prisma.payOrder.aggregate({
        where: { createdAt: { gte: todayStart, lte: todayEnd }, status: PayOrderStatus.SUCCESS },
        _sum: { amount: true },
      }),
      this.prisma.reconcileDiff.count({ where: { handleStatus: 'PENDING' } }),
      this.prisma.notifyTask.count({ where: { status: { in: ['FAILED', 'DEAD'] } } }),
      this.prisma.reconcileTask.count({ where: { status: 'RUNNING' } }),
    ]);

    // 近 7 日交易趋势
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const s = dayjs().subtract(i, 'day').startOf('day').toDate();
      const e = dayjs().subtract(i, 'day').endOf('day').toDate();
      const [cnt, succ] = await Promise.all([
        this.prisma.payOrder.count({ where: { createdAt: { gte: s, lte: e } } }),
        this.prisma.payOrder.count({ where: { createdAt: { gte: s, lte: e }, status: PayOrderStatus.SUCCESS } }),
      ]);
      trend.push({ date: dayjs(s).format('YYYY-MM-DD'), total: cnt, success: succ });
    }

    return {
      today: {
        orderCount: totalToday,
        successCount: successToday,
        successRate: totalToday ? Money.mul(Money.div(successToday, totalToday), 100).toFixed(2) : '0.00',
        successAmount: amountAgg._sum.amount ? Money.format(amountAgg._sum.amount) : '0.00',
      },
      pendingDiffCount: pendingDiff,
      failedNotifyCount: deadNotify,
      runningTaskCount: runningTask,
      trend,
    };
  }

  @Get('notifies')
  @ApiOperation({ summary: '通知任务列表' })
  async notifies(@Query() q: any) {
    return this.notifyService.list({
      bizType: q.bizType,
      bizNo: q.bizNo,
      appId: q.appId,
      status: q.status,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Post('notifies/:id/redeliver')
  @ApiOperation({ summary: '人工重投通知' })
  async redeliver(@Req() req: Request, @Param('id') id: string) {
    await this.notifyService.redeliver(Number(id), currentAdmin(req).username);
    return { success: true };
  }

  @Get('logs')
  @ApiOperation({ summary: '操作日志查询' })
  async logs(@Query() q: any) {
    return this.opLog.list({
      operator: q.operator,
      module: q.module,
      action: q.action,
      keyword: q.keyword,
      startTime: q.startTime ? dayjs(q.startTime).toDate() : undefined,
      endTime: q.endTime ? dayjs(q.endTime).toDate() : undefined,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Get('health')
  @ApiOperation({ summary: '健康检查（DB 连通性）' })
  async health() {
    const dbOk = await this.prisma.ping();
    return { db: dbOk, time: new Date().toISOString() };
  }
}
