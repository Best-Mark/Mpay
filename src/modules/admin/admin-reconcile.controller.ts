import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ReconcileService } from '../reconcile/reconcile.service';
import { BillService } from '../reconcile/bill.service';
import { AdminAuthGuard, currentAdmin } from './admin-auth.guard';
import { HandleStatus, ReconcilePeriod } from '../../common/constants/enums';

@ApiTags('管理后台-对账')
@Controller('api/admin/reconcile')
@UseGuards(AdminAuthGuard)
export class AdminReconcileController {
  constructor(
    private readonly reconcileService: ReconcileService,
    private readonly billService: BillService,
  ) {}

  @Post('run')
  @ApiOperation({ summary: '手动触发对账（指定日期与渠道，缺失账单会自动补拉）' })
  async run(@Req() req: Request, @Body() body: { billDate: string; channel?: string; appId?: string; mchId?: string; autoFetch?: boolean }) {
    return this.reconcileService.run({
      billDate: body.billDate,
      channel: body.channel || 'ALL',
      appId: body.appId,
      mchId: body.mchId,
      periodType: ReconcilePeriod.DAILY,
      triggeredBy: currentAdmin(req).username,
      triggerType: 'MANUAL',
      autoFetch: body.autoFetch,
    });
  }

  @Get('tasks')
  @ApiOperation({ summary: '对账报告列表' })
  async tasks(@Query() q: any) {
    return this.reconcileService.listTasks({
      billDate: q.billDate,
      startDate: q.startDate,
      endDate: q.endDate,
      channel: q.channel,
      appId: q.appId,
      status: q.status,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Get('tasks/:taskNo')
  @ApiOperation({ summary: '对账报告详情（含差异类型分布）' })
  async report(@Param('taskNo') taskNo: string) {
    return this.reconcileService.getReport(taskNo);
  }

  @Get('tasks/:taskNo/diffs')
  @ApiOperation({ summary: '对账差异明细' })
  async diffs(@Param('taskNo') taskNo: string, @Query() q: any) {
    return this.reconcileService.listDiffs({
      taskNo,
      diffType: q.diffType,
      handleStatus: q.handleStatus,
      keyword: q.keyword,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Get('tasks/:taskNo/export')
  @ApiOperation({ summary: '导出对账报告 Excel（汇总 + 差异明细）' })
  async export(@Param('taskNo') taskNo: string, @Res() res: Response) {
    const { filename, buffer } = await this.reconcileService.exportExcel(taskNo);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('diffs')
  @ApiOperation({ summary: '跨批次的差异查询（按日期/渠道/处理状态筛选）' })
  async allDiffs(@Query() q: any) {
    return this.reconcileService.listDiffs({
      diffType: q.diffType,
      handleStatus: q.handleStatus,
      channel: q.channel,
      appId: q.appId,
      billDate: q.billDate,
      keyword: q.keyword,
      page: Number(q.page || 1),
      pageSize: Number(q.pageSize || 20),
    });
  }

  @Post('diffs/:id/handle')
  @ApiOperation({ summary: '处理差异：人工确认 / 补单 / 冲正 / 忽略' })
  async handle(@Req() req: Request, @Param('id') id: string, @Body() body: { action: HandleStatus; remark?: string }) {
    return this.reconcileService.handleDiff({
      diffId: Number(id),
      action: body.action,
      handler: currentAdmin(req).username,
      remark: body.remark,
      ip: (req.ip || '').replace('::ffff:', ''),
    });
  }

  @Post('bills/fetch')
  @ApiOperation({ summary: '手动补拉渠道账单' })
  async fetchBill(@Req() req: Request, @Body() body: { channel: string; billDate: string }) {
    return this.billService.fetchAndStore({
      channel: body.channel,
      billDate: body.billDate,
      operator: currentAdmin(req).username,
    });
  }

  @Post('bills/upload')
  @ApiOperation({ summary: '手动上传账单文件（CSV 文本），用于渠道下载失败时补拉' })
  async uploadBill(@Req() req: Request, @Body() body: { channel: string; billDate: string; content: string }) {
    return this.billService.uploadAndStore({
      channel: body.channel,
      billDate: body.billDate,
      content: body.content,
      operator: currentAdmin(req).username,
    });
  }

  @Get('bills')
  @ApiOperation({ summary: '查询某日账单入库情况' })
  async billStatus(@Query() q: { channel: string; billDate: string }) {
    const count = await this.billService.hasBill(q.channel, q.billDate);
    return { channel: q.channel, billDate: q.billDate, count };
  }
}
