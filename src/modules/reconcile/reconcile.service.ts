import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { RedisService } from '../../common/redis/redis.service';
import { BillService } from './bill.service';
import { PaymentService } from '../payment/payment.service';
import { Money } from '../../common/utils/money';
import { DateUtil } from '../../common/utils/date.util';
import { OrderNoUtil } from '../../common/utils/order-no';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { SystemConfigService } from '../../common/config/system-config.service';
import { MailService } from '../mail/mail.service';
import {
  Channel,
  DiffType,
  DiffTypeLabel,
  HandleStatus,
  PayOrderStatus,
  ReconcilePeriod,
  ReconcileStatus,
} from '../../common/constants/enums';

/** 默认每日对账 cron（对前一日） */
const DEFAULT_RECONCILE_CRON = '30 6 * * *';
/** 默认每日拉单 cron */
const DEFAULT_BILL_FETCH_CRON = '0 7 * * *';

interface DiffItem {
  diffType: string;
  severity: string;
  payOrderNo?: string;
  merchantOrderNo?: string;
  channelTradeNo?: string;
  centerAmount?: string;
  channelAmount?: string;
  diffAmount: string;
  centerStatus?: string;
  channelStatus?: string;
  refundNo?: string;
}

/**
 * 对账引擎（本项目核心能力）
 *
 * 单次对账流程：
 *   1. 建批次（RUNNING）
 *   2. 确保渠道账单已入库（无则自动下载，失败可手动上传补拉）
 *   3. 载入「渠道账单」与「支付中心订单」两侧数据
 *   4. 以「支付中心订单号 + 金额 + 状态」为基准做双向匹配
 *   5. 差异分类入库（长款/短款/金额不符/状态不符/重复支付/退款差异）
 *   6. 汇总生成对账报告，超阈值告警
 */
@Injectable()
export class ReconcileService implements OnModuleInit {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billService: BillService,
    private readonly paymentService: PaymentService,
    private readonly opLog: OperationLogService,
    private readonly redis: RedisService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cfg: SystemConfigService,
    private readonly mail: MailService,
  ) {}

  /** 运行时注册定时任务，cron 表达式可由环境变量覆盖（装饰器无法读取运行时 env） */
  onModuleInit() {
    const auto = (process.env.RECONCILE_AUTO_ENABLED ?? 'true') !== 'false';
    if (!auto) {
      this.logger.warn('自动对账已关闭（RECONCILE_AUTO_ENABLED=false）');
      return;
    }
    try {
      const fetchCron = process.env.BILL_FETCH_CRON || DEFAULT_BILL_FETCH_CRON;
      const recoCron = process.env.RECONCILE_CRON || DEFAULT_RECONCILE_CRON;
      const fetchJob = new CronJob(fetchCron, () => this.autoFetchBills());
      const recoJob = new CronJob(recoCron, () => this.autoDailyReconcile());
      this.scheduler.addCronJob('autoFetchBills', fetchJob);
      this.scheduler.addCronJob('autoDailyReconcile', recoJob);
      fetchJob.start();
      recoJob.start();
      this.logger.log(`对账定时任务已注册：拉单 ${fetchCron} / 对账 ${recoCron}`);
    } catch (e: any) {
      this.logger.error(`定时任务注册失败: ${e.message}`);
    }
  }

  // ==================== 调度入口 ====================

  /** 每日自动拉单：拉取前一日「全部商户号」的账单 */
  private async autoFetchBills(): Promise<void> {
    const billDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    try {
      const r = await this.billService.fetchAllAndStore({ billDate, operator: 'SYSTEM' });
      this.logger.log(
        `[autoFetch] ${billDate} 全量账单：目标 ${r.total} 个商户号，成功 ${r.succeeded}、跳过(已有) ${r.skipped}、失败 ${r.failed}`,
      );
      if (r.failed) {
        this.logger.error(
          `[autoFetch] ${billDate} 以下商户号账单拉取失败：${r.errors.map((e) => `${e.channel}/${e.mchId}(${e.error})`).join('; ')}`,
        );
      }
    } catch (e: any) {
      this.logger.error(`[autoFetch] ${billDate}: ${e.message}`);
    }
  }

  /** 每日自动对账：对账前一日 */
  private async autoDailyReconcile(): Promise<void> {
    const billDate = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const channels = await this.billService.listActiveChannels();
    for (const channel of channels) {
      try {
        await this.run({
          billDate,
          channel,
          periodType: ReconcilePeriod.DAILY,
          triggeredBy: 'SYSTEM',
          triggerType: 'AUTO_SCHEDULE',
        });
      } catch (e: any) {
        this.logger.error(`[autoReconcile] ${channel} ${billDate}: ${e.message}`);
      }
    }
  }

  // ==================== 执行对账 ====================

  async run(params: {
    billDate: string;
    channel: string;
    periodType?: ReconcilePeriod;
    startTime?: Date;
    endTime?: Date;
    appId?: string;
    mchId?: string;
    triggeredBy?: string;
    triggerType?: 'AUTO_SCHEDULE' | 'MANUAL' | 'RETRY';
    /** 账单缺失时是否自动下载 */
    autoFetch?: boolean;
    /** 强制重新拉取账单（账单已存在时也刷新，入库按唯一键 upsert，不会重复） */
    forceFetch?: boolean;
  }): Promise<any> {
    const billDate = params.billDate;
    const channel = params.channel || 'ALL';
    const started = Date.now();

    // 分布式锁：同一 日期+渠道 不允许并发对账（多实例部署时必需）
    const lockKey = `reconcile:${billDate}:${channel}:${params.appId || 'ALL'}`;
    const token = await this.redis.tryLock(lockKey, 1800);
    if (!token) throw new BizException(ErrorCode.RECONCILE_RUNNING, '该日期/渠道的对账正在执行中');

    const taskNo = OrderNoUtil.reconcileTaskNo(billDate.replace(/-/g, ''));
    const task = await this.prisma.reconcileTask.create({
      data: {
        taskNo,
        periodType: params.periodType || ReconcilePeriod.DAILY,
        billDate: DateUtil.billDate(billDate),
        startTime: params.startTime,
        endTime: params.endTime,
        channel,
        appId: params.appId || 'ALL',
        mchId: params.mchId || 'ALL',
        status: ReconcileStatus.RUNNING,
        triggeredBy: params.triggeredBy || 'SYSTEM',
        triggerType: params.triggerType || 'MANUAL',
        billSource: 'AUTO',
      },
    });

    try {
      // 1. 确保账单就绪：遍历该渠道下「每一个商户号」逐个判缺补拉
      //    只按渠道判缺时，默认号有账单就认为就绪，其余商户号永远不下载 —— 等于漏对账。
      const billTargets = (await this.billService.listBillTargets()).filter(
        (t) => channel === 'ALL' || t.channel === channel,
      );
      const fetchErrors: string[] = [];
      for (const t of billTargets) {
        const count = await this.billService.hasBillForMch(t.channel, t.mchId, billDate);
        if (!((count === 0 || params.forceFetch) && (params.autoFetch ?? true))) continue;
        this.logger.log(
          `[reconcile] ${t.channel}/${t.mchId} ${billDate} 账单 ${count} 行${params.forceFetch ? '（强制刷新）' : '，尝试自动下载'}`,
        );
        try {
          await this.billService.fetchAndStore({
            channel: t.channel,
            billDate,
            configId: t.configId,
            operator: params.triggeredBy || 'SYSTEM',
            taskId: task.id,
          });
        } catch (e: any) {
          // 单个商户号失败不拖垮整批对账，但必须留在报告里，不能静默
          fetchErrors.push(`${t.channel}/${t.mchId}: ${e.message}`);
          this.logger.error(`[reconcile] ${t.channel}/${t.mchId} ${billDate} 账单拉取失败: ${e.message}`);
        }
      }
      // 该渠道未配置商户号（如 Mock）：退回按渠道默认配置拉一次，保持既有行为
      if (!billTargets.length && channel !== 'ALL') {
        const count = await this.billService.hasBill(channel, billDate);
        if ((count === 0 || params.forceFetch) && (params.autoFetch ?? true)) {
          try {
            await this.billService.fetchAndStore({
              channel,
              billDate,
              operator: params.triggeredBy || 'SYSTEM',
              taskId: task.id,
            });
          } catch (e: any) {
            fetchErrors.push(`${channel}: ${e.message}`);
          }
        }
      }

      // 2. 载入渠道账单
      const billWhere: any = { billDate: DateUtil.billDate(billDate), billType: 'TRADE' };
      if (channel !== 'ALL') billWhere.channel = channel;
      if (params.mchId) billWhere.mchId = params.mchId;
      if (params.appId) billWhere.appId = params.appId;
      const bills = await this.prisma.channelBill.findMany({ where: billWhere });

      // 3. 载入支付中心订单（按支付成功时间落在对账日）
      //    按商户号对账时订单侧必须同步按 channelMchId 收敛，否则其他商户号的订单
      //    会被判成「中心有、渠道无」的假短款（下单即写入 channelMchId，见 payment.service）
      const { start: dayStart, end: dayEnd } = DateUtil.localDayRange(billDate);
      const orderWhere: any = {
        paidAt: { gte: dayStart, lte: dayEnd },
        status: { in: [PayOrderStatus.SUCCESS, PayOrderStatus.REFUNDING, PayOrderStatus.REFUNDED] },
      };
      if (channel !== 'ALL') orderWhere.channel = channel;
      if (params.mchId) orderWhere.channelMchId = params.mchId;
      if (params.appId) orderWhere.appId = params.appId;
      const orders = await this.prisma.payOrder.findMany({ where: orderWhere });

      // 4. 匹配
      const result = this.match(bills, orders);

      // 5. 差异入库
      if (result.diffs.length) {
        await this.prisma.reconcileDiff.createMany({
          data: result.diffs.map((d) => ({
            taskId: task.id,
            diffType: d.diffType,
            severity: d.severity,
            billDate: DateUtil.billDate(billDate),
            channel: channel === 'ALL' ? d.channel || 'ALL' : channel,
            appId: d.appId,
            payOrderNo: d.payOrderNo,
            merchantOrderNo: d.merchantOrderNo,
            channelTradeNo: d.channelTradeNo,
            centerAmount: d.centerAmount ? Money.round(d.centerAmount, 2) : null,
            channelAmount: d.channelAmount ? Money.round(d.channelAmount, 2) : null,
            diffAmount: Money.round(d.diffAmount, 2),
            centerStatus: d.centerStatus,
            channelStatus: d.channelStatus,
            refundNo: d.refundNo,
          })),
        });
      }

      // 6. 汇总更新
      const matchRate = result.channelCount > 0 ? Money.div(result.matchedCount, result.channelCount) : Money.D(0);
      // 有商户号账单没拉到时，即使账面全平也不能算 SUCCESS —— 漏掉的那部分根本没对过
      const finished = await this.prisma.reconcileTask.update({
        where: { id: task.id },
        data: {
          status: result.diffs.length || fetchErrors.length ? ReconcileStatus.PARTIAL : ReconcileStatus.SUCCESS,
          errorMessage: fetchErrors.length ? `账单拉取失败：${fetchErrors.join('; ')}`.slice(0, 1000) : null,
          channelCount: result.channelCount,
          channelAmount: Money.round(result.channelAmount, 2),
          centerCount: result.centerCount,
          centerAmount: Money.round(result.centerAmount, 2),
          matchedCount: result.matchedCount,
          matchedAmount: Money.round(result.matchedAmount, 2),
          diffCount: result.diffs.length,
          diffAmount: Money.round(result.diffAmount, 2),
          matchRate: matchRate.toDecimalPlaces(4),
          finishedAt: new Date(),
          durationMs: Date.now() - started,
        },
      });

      await this.opLog.write({
        operator: params.triggeredBy || 'SYSTEM',
        operatorType: params.triggeredBy && params.triggeredBy !== 'SYSTEM' ? 'ADMIN' : 'SYSTEM',
        module: 'reconcile',
        action: 'run',
        targetId: taskNo,
        detail: `对账 ${billDate} ${channel}：渠道 ${result.channelCount} 笔 / 中心 ${result.centerCount} 笔，平账 ${result.matchedCount} 笔，差异 ${result.diffs.length} 笔`,
      });

      // 7. 差异超阈值告警：阈值走系统配置（后台可调，不必重启）
      const threshold = await this.cfg.getDiffThreshold();
      if (result.diffs.length >= threshold) {
        this.logger.error(
          `[reconcile-alert] ${billDate} ${channel} 差异 ${result.diffs.length} 笔（阈值 ${threshold}），差异金额 ${Money.format(result.diffAmount)} 元，需人工介入`,
        );
        if (await this.cfg.getBool('alert.reconcileDiff', true)) {
          this.mail.alert(
            `[支付中心告警] 对账差异 ${result.diffs.length} 笔 ${billDate} ${channel}`,
            [
              `对账批次：${taskNo}`,
              `账单日期：${billDate}`,
              `渠道：${channel}`,
              `渠道笔数：${result.channelCount}`,
              `中心笔数：${result.centerCount}`,
              `差异笔数：${result.diffs.length}（阈值 ${threshold}）`,
              `差异金额：${Money.format(result.diffAmount)} 元`,
              '',
              '请登录管理后台「对账中心」处理差异。',
            ].join('\n'),
            `reconcile-diff-${billDate}-${channel}-${taskNo}`,
          ).catch(() => undefined);
        }
      }

      return this.toReportView(finished);
    } catch (e: any) {
      await this.prisma.reconcileTask.update({
        where: { id: task.id },
        data: {
          status: ReconcileStatus.FAILED,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          errorMessage: e.message?.slice(0, 1000),
        },
      });
      throw e;
    } finally {
      await this.redis.releaseLock(lockKey, token);
    }
  }

  /**
   * 双向匹配算法（对账的核心）
   * 匹配基准：支付中心订单号(outTradeNo) + 金额 + 状态
   */
  private match(bills: any[], orders: any[]): {
    channelCount: number;
    channelAmount: string;
    centerCount: number;
    centerAmount: string;
    matchedCount: number;
    matchedAmount: string;
    diffAmount: string;
    diffs: (DiffItem & { channel?: string; appId?: string })[];
  } {
    const centerMap = new Map<string, any>();
    const centerByMerchant = new Map<string, any[]>();
    for (const o of orders) {
      centerMap.set(o.payOrderNo, o);
      const key = `${o.appId}:${o.merchantOrderNo}`;
      const arr = centerByMerchant.get(key) || [];
      arr.push(o);
      centerByMerchant.set(key, arr);
    }

    const diffs: (DiffItem & { channel?: string; appId?: string })[] = [];
    /** 渠道侧已匹配到的中心订单号 */
    const matchedCenter = new Set<string>();
    let matchedCount = 0;
    // 注意：Decimal 是不可变对象，累加必须重新赋值
    let matchedAmount = Money.D(0);
    let channelAmount = Money.D(0);
    let centerAmount = Money.D(0);
    let diffAmount = Money.D(0);

    // ---- 方向一：以渠道账单为准，找中心 ----
    for (const b of bills) {
      const chAmount = Money.D(b.amount);
      channelAmount = channelAmount.plus(chAmount);

      // 重复支付检测：同一商户订单号在渠道出现多笔成功交易
      const dupKey = b.outTradeNo ? `${b.appId || ''}:${b.merchantOrderNo}` : '';
      const center = b.outTradeNo ? centerMap.get(b.outTradeNo) : undefined;

      if (!center) {
        // 渠道有、中心无 —— 长款（钱多收了，需补单或退回）
        diffs.push({
          diffType: DiffType.CHANNEL_ONLY,
          severity: 'HIGH',
          payOrderNo: b.outTradeNo || undefined,
          merchantOrderNo: b.merchantOrderNo || undefined,
          channelTradeNo: b.tradeNo,
          centerAmount: undefined,
          channelAmount: Money.format(chAmount),
          diffAmount: Money.format(chAmount),
          centerStatus: undefined,
          channelStatus: b.tradeStatus,
          channel: b.channel,
          appId: b.appId || undefined,
        });
        diffAmount = diffAmount.plus(chAmount);
        continue;
      }

      // 同一业务订单号在中心存在多笔成功 —— 重复支付
      const sameMerchant = dupKey ? centerByMerchant.get(dupKey) || [] : [];
      if (sameMerchant.length > 1) {
        diffs.push({
          diffType: DiffType.DUPLICATE,
          severity: 'HIGH',
          payOrderNo: center.payOrderNo,
          merchantOrderNo: center.merchantOrderNo,
          channelTradeNo: b.tradeNo,
          centerAmount: Money.format(center.amount),
          channelAmount: Money.format(chAmount),
          diffAmount: Money.format(Money.sub(chAmount, center.amount)),
          centerStatus: center.status,
          channelStatus: b.tradeStatus,
          channel: b.channel,
          appId: center.appId,
        });
        diffAmount = diffAmount.plus(Money.sub(chAmount, center.amount).abs());
        matchedCenter.add(center.payOrderNo);
        continue;
      }

      // 金额不符
      const centerAmt = Money.D(center.paidAmount ?? center.amount);
      if (!Money.eq(centerAmt, chAmount)) {
        diffs.push({
          diffType: DiffType.AMOUNT_DIFF,
          severity: 'HIGH',
          payOrderNo: center.payOrderNo,
          merchantOrderNo: center.merchantOrderNo,
          channelTradeNo: b.tradeNo,
          centerAmount: Money.format(centerAmt),
          channelAmount: Money.format(chAmount),
          diffAmount: Money.format(Money.sub(chAmount, centerAmt)),
          centerStatus: center.status,
          channelStatus: b.tradeStatus,
          channel: b.channel,
          appId: center.appId,
        });
        diffAmount = diffAmount.plus(Money.sub(chAmount, centerAmt).abs());
        matchedCenter.add(center.payOrderNo);
        continue;
      }

      // 状态不符：渠道成功但中心未成功（或反之）
      const centerOk = [PayOrderStatus.SUCCESS, PayOrderStatus.REFUNDING, PayOrderStatus.REFUNDED].includes(center.status);
      const channelOk = b.tradeStatus === 'SUCCESS' || b.tradeStatus === 'REFUND';
      if (centerOk !== channelOk) {
        diffs.push({
          diffType: DiffType.STATUS_DIFF,
          severity: 'MEDIUM',
          payOrderNo: center.payOrderNo,
          merchantOrderNo: center.merchantOrderNo,
          channelTradeNo: b.tradeNo,
          centerAmount: Money.format(centerAmt),
          channelAmount: Money.format(chAmount),
          diffAmount: '0.00',
          centerStatus: center.status,
          channelStatus: b.tradeStatus,
          channel: b.channel,
          appId: center.appId,
        });
        matchedCenter.add(center.payOrderNo);
        continue;
      }

      // 退款核对：渠道已退款金额 vs 中心已退金额
      const chRefund = Money.D(b.refundAmount || 0);
      const centerRefund = Money.D(center.refundedAmount || 0);
      if (!Money.eq(chRefund, centerRefund)) {
        diffs.push({
          diffType: DiffType.REFUND_DIFF,
          severity: 'MEDIUM',
          payOrderNo: center.payOrderNo,
          merchantOrderNo: center.merchantOrderNo,
          channelTradeNo: b.tradeNo,
          centerAmount: Money.format(centerRefund),
          channelAmount: Money.format(chRefund),
          diffAmount: Money.format(Money.sub(chRefund, centerRefund)),
          centerStatus: center.status,
          channelStatus: b.tradeStatus,
          channel: b.channel,
          appId: center.appId,
        });
        diffAmount = diffAmount.plus(Money.sub(chRefund, centerRefund).abs());
        matchedCenter.add(center.payOrderNo);
        continue;
      }

      // 平账
      matchedCount++;
      matchedAmount = matchedAmount.plus(chAmount);
      matchedCenter.add(center.payOrderNo);
    }

    // ---- 方向二：中心有、渠道无 —— 短款 ----
    for (const o of orders) {
      if (matchedCenter.has(o.payOrderNo)) continue;
      const amt = Money.D(o.paidAmount ?? o.amount);
      centerAmount = centerAmount.plus(amt);
      diffs.push({
        diffType: DiffType.CENTER_ONLY,
        severity: 'HIGH',
        payOrderNo: o.payOrderNo,
        merchantOrderNo: o.merchantOrderNo,
        channelTradeNo: o.channelTxnId || undefined,
        centerAmount: Money.format(amt),
        channelAmount: undefined,
        diffAmount: Money.format(Money.D(0).minus(amt)),
        centerStatus: o.status,
        channelStatus: undefined,
        channel: o.channel,
        appId: o.appId,
      });
      diffAmount = diffAmount.plus(amt);
    }

    return {
      channelCount: bills.length,
      channelAmount: channelAmount.toString(),
      centerCount: orders.length,
      centerAmount: centerAmount.toString(),
      matchedCount,
      matchedAmount: matchedAmount.toString(),
      diffAmount: diffAmount.toString(),
      diffs,
    };
  }

  // ==================== 报告查询 ====================

  async listTasks(params: {
    billDate?: string;
    startDate?: string;
    endDate?: string;
    channel?: string;
    appId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.billDate) where.billDate = DateUtil.billDate(params.billDate);
    if (params.startDate || params.endDate) {
      where.billDate = {};
      if (params.startDate) where.billDate.gte = DateUtil.billDate(params.startDate);
      if (params.endDate) where.billDate.lte = DateUtil.billDate(params.endDate);
    }
    if (params.channel) where.channel = params.channel;
    if (params.appId) where.appId = params.appId;
    if (params.status) where.status = params.status;

    const [list, total] = await Promise.all([
      this.prisma.reconcileTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reconcileTask.count({ where }),
    ]);
    return { list: list.map((t) => this.toReportView(t)), total, page, pageSize };
  }

  async getReport(taskNo: string) {
    const task = await this.prisma.reconcileTask.findUnique({ where: { taskNo } });
    if (!task) throw new BizException(ErrorCode.RECONCILE_TASK_NOT_FOUND);

    // 差异类型分布
    const group = await this.prisma.reconcileDiff.groupBy({
      by: ['diffType'],
      where: { taskId: task.id },
      _count: { _all: true },
      _sum: { diffAmount: true },
    });
    const handleGroup = await this.prisma.reconcileDiff.groupBy({
      by: ['handleStatus'],
      where: { taskId: task.id },
      _count: { _all: true },
    });

    return {
      ...this.toReportView(task),
      diffBreakdown: group.map((g) => ({
        diffType: g.diffType,
        label: DiffTypeLabel[g.diffType] || g.diffType,
        count: g._count._all,
        amount: Money.format(g._sum.diffAmount || 0),
      })),
      handleBreakdown: handleGroup.map((g) => ({ handleStatus: g.handleStatus, count: g._count._all })),
    };
  }

  async listDiffs(params: {
    taskNo?: string;
    taskId?: number;
    diffType?: string;
    handleStatus?: string;
    channel?: string;
    appId?: string;
    billDate?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(500, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.taskId) where.taskId = BigInt(params.taskId);
    if (params.taskNo) {
      const t = await this.prisma.reconcileTask.findUnique({ where: { taskNo: params.taskNo } });
      if (!t) throw new BizException(ErrorCode.RECONCILE_TASK_NOT_FOUND);
      where.taskId = t.id;
    }
    if (params.diffType) where.diffType = params.diffType;
    if (params.handleStatus) where.handleStatus = params.handleStatus;
    if (params.channel) where.channel = params.channel;
    if (params.appId) where.appId = params.appId;
    if (params.billDate) where.billDate = DateUtil.billDate(params.billDate);
    if (params.keyword) {
      where.OR = [
        { payOrderNo: { contains: params.keyword } },
        { merchantOrderNo: { contains: params.keyword } },
        { channelTradeNo: { contains: params.keyword } },
      ];
    }

    const [list, total] = await Promise.all([
      this.prisma.reconcileDiff.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.reconcileDiff.count({ where }),
    ]);
    return { list: list.map((d) => this.toDiffView(d)), total, page, pageSize };
  }

  // ==================== 差异人工处理 ====================

  /**
   * 处理差异（需求 3.2.3 异常处理：人工确认、补单、冲正、忽略，并记录操作日志）
   */
  async handleDiff(params: {
    diffId: number;
    action: HandleStatus;
    handler: string;
    remark?: string;
    ip?: string;
  }) {
    const diff = await this.prisma.reconcileDiff.findUnique({ where: { id: BigInt(params.diffId) } });
    if (!diff) throw new BizException(ErrorCode.RECONCILE_DIFF_NOT_FOUND);
    if (diff.handleStatus !== HandleStatus.PENDING) {
      throw new BizException(ErrorCode.RECONCILE_DIFF_HANDLED, '该差异已处理');
    }

    switch (params.action) {
      case HandleStatus.COMPENSATED:
        // 补单：渠道确实收到钱但中心无记录 -> 将中心订单补记为已支付并通知业务系统
        if (!diff.payOrderNo) throw new BizException(ErrorCode.PARAM_ERROR, '该差异无支付中心订单号，无法补单');
        await this.compensate(diff);
        break;
      case HandleStatus.REVERSED:
        // 冲正：中心记了账但渠道没有 -> 撤销中心订单状态（需人工确认后执行）
        if (!diff.payOrderNo) throw new BizException(ErrorCode.PARAM_ERROR, '该差异无支付中心订单号，无法冲正');
        await this.reverse(diff);
        break;
      case HandleStatus.PROCESSED:
      case HandleStatus.IGNORED:
      default:
        // 仅标记，不改订单（用于已线下核实一致/确认无风险的场景）
        break;
    }

    const updated = await this.prisma.reconcileDiff.update({
      where: { id: BigInt(params.diffId) },
      data: {
        handleStatus: params.action,
        handleAction: params.action,
        handler: params.handler,
        handleRemark: params.remark,
        handledAt: new Date(),
      },
    });

    await this.opLog.write({
      operator: params.handler,
      operatorType: 'ADMIN',
      module: 'reconcile',
      action: 'handle_diff',
      targetId: String(params.diffId),
      detail: `处理对账差异[${DiffTypeLabel[diff.diffType] || diff.diffType}] ${diff.payOrderNo || diff.channelTradeNo || ''}：${params.action}${params.remark ? ` - ${params.remark}` : ''}`,
      payload: { before: this.toDiffView(diff), after: this.toDiffView(updated) },
      ip: params.ip,
    });

    return this.toDiffView(updated);
  }

  /** 补单：把渠道真实收款补记到支付中心并通知业务系统 */
  private async compensate(diff: any): Promise<void> {
    const exist = await this.prisma.payOrder.findUnique({ where: { payOrderNo: diff.payOrderNo } });
    if (!exist) {
      this.logger.warn(`[compensate] 订单不存在，无法补单: ${diff.payOrderNo}`);
      throw new BizException(ErrorCode.ORDER_NOT_FOUND, '补单失败：支付中心订单不存在');
    }
    if (exist.status === PayOrderStatus.SUCCESS) return; // 已成功则无需补单

    await this.paymentService.markPaid(diff.payOrderNo, {
      channelTxnId: diff.channelTradeNo || undefined,
      paidAmount: diff.channelAmount || diff.centerAmount,
      paidAt: new Date(`${DateUtil.localDay(new Date(diff.billDate))}T12:00:00`),
    });
  }

  /** 冲正：撤销中心侧记账（人工确认渠道确实未收款） */
  private async reverse(diff: any): Promise<void> {
    const exist = await this.prisma.payOrder.findUnique({ where: { payOrderNo: diff.payOrderNo } });
    if (!exist) throw new BizException(ErrorCode.ORDER_NOT_FOUND, '冲正失败：支付中心订单不存在');
    if (exist.status !== PayOrderStatus.SUCCESS) return;
    await this.prisma.payOrder.update({
      where: { payOrderNo: diff.payOrderNo },
      data: { status: PayOrderStatus.CLOSED, closedAt: new Date() },
    });
  }

  // ==================== 导出 ====================

  /** 导出对账报告 Excel：汇总页 + 差异明细页 */
  async exportExcel(taskNo: string): Promise<{ filename: string; buffer: Buffer }> {
    const task = await this.prisma.reconcileTask.findUnique({ where: { taskNo } });
    if (!task) throw new BizException(ErrorCode.RECONCILE_TASK_NOT_FOUND);
    const diffs = await this.prisma.reconcileDiff.findMany({
      where: { taskId: task.id },
      orderBy: [{ diffType: 'asc' }, { id: 'asc' }],
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = '统一支付中心';
    wb.created = new Date();

    // ---- Sheet1 汇总 ----
    const s1 = wb.addWorksheet('对账汇总', { views: [{ state: 'frozen', ySplit: 1 }] });
    s1.columns = [
      { header: '项目', key: 'k', width: 22 },
      { header: '内容', key: 'v', width: 40 },
    ];
    const billDateStr = dayjs(task.billDate).format('YYYY-MM-DD');
    const rows1: [string, any][] = [
      ['对账批次号', task.taskNo],
      ['对账日期', billDateStr],
      ['对账周期', task.periodType === 'DAILY' ? '日对账' : task.periodType === 'MONTHLY' ? '月对账' : '自定义'],
      ['支付渠道', task.channel === 'ALL' ? '全部渠道' : task.channel],
      ['业务项目(AppId)', task.appId === 'ALL' ? '全部业务' : task.appId],
      ['商户号', task.mchId === 'ALL' ? '全部' : task.mchId],
      ['渠道账单笔数', task.channelCount],
      ['渠道账单金额(元)', Money.format(task.channelAmount)],
      ['支付中心订单笔数', task.centerCount],
      ['支付中心订单金额(元)', Money.format(task.centerAmount)],
      ['平账笔数', task.matchedCount],
      ['平账金额(元)', Money.format(task.matchedAmount)],
      ['差异笔数', task.diffCount],
      ['差异金额(元)', Money.format(task.diffAmount)],
      ['平账率', `${Money.mul(task.matchRate || 0, 100).toFixed(2)}%`],
      ['对账状态', task.status],
      ['执行时间', task.finishedAt ? dayjs(task.finishedAt).format('YYYY-MM-DD HH:mm:ss') : '-'],
      ['耗时(毫秒)', task.durationMs ?? '-'],
      ['执行人', task.triggeredBy],
      ['触发方式', task.triggerType],
    ];
    rows1.forEach(([k, v]) => s1.addRow({ k, v }));
    s1.getRow(1).font = { bold: true };

    // ---- Sheet2 差异明细 ----
    const s2 = wb.addWorksheet('差异明细', { views: [{ state: 'frozen', ySplit: 1 }] });
    s2.columns = [
      { header: '差异类型', key: 'diffType', width: 20 },
      { header: '严重级别', key: 'severity', width: 10 },
      { header: '支付中心订单号', key: 'payOrderNo', width: 30 },
      { header: '业务订单号', key: 'merchantOrderNo', width: 26 },
      { header: '渠道交易号', key: 'channelTradeNo', width: 28 },
      { header: '业务项目', key: 'appId', width: 20 },
      { header: '渠道', key: 'channel', width: 12 },
      { header: '中心金额', key: 'centerAmount', width: 14 },
      { header: '渠道金额', key: 'channelAmount', width: 14 },
      { header: '差额', key: 'diffAmount', width: 14 },
      { header: '中心状态', key: 'centerStatus', width: 14 },
      { header: '渠道状态', key: 'channelStatus', width: 14 },
      { header: '处理状态', key: 'handleStatus', width: 14 },
      { header: '处理人', key: 'handler', width: 14 },
      { header: '处理时间', key: 'handledAt', width: 20 },
      { header: '备注', key: 'handleRemark', width: 30 },
    ];
    diffs.forEach((d) =>
      s2.addRow({
        diffType: DiffTypeLabel[d.diffType] || d.diffType,
        severity: d.severity,
        payOrderNo: d.payOrderNo || '',
        merchantOrderNo: d.merchantOrderNo || '',
        channelTradeNo: d.channelTradeNo || '',
        appId: d.appId || '',
        channel: d.channel,
        centerAmount: d.centerAmount ? Money.format(d.centerAmount) : '',
        channelAmount: d.channelAmount ? Money.format(d.channelAmount) : '',
        diffAmount: Money.format(d.diffAmount),
        centerStatus: d.centerStatus || '',
        channelStatus: d.channelStatus || '',
        handleStatus: d.handleStatus,
        handler: d.handler || '',
        handledAt: d.handledAt ? dayjs(d.handledAt).format('YYYY-MM-DD HH:mm:ss') : '',
        handleRemark: d.handleRemark || '',
      }),
    );
    s2.getRow(1).font = { bold: true };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: `对账报告_${taskNo}.xlsx`, buffer };
  }

  // ==================== 视图 ====================

  private toReportView(t: any) {
    return {
      id: Number(t.id),
      taskNo: t.taskNo,
      periodType: t.periodType,
      billDate: dayjs(t.billDate).format('YYYY-MM-DD'),
      startTime: t.startTime,
      endTime: t.endTime,
      channel: t.channel,
      appId: t.appId,
      mchId: t.mchId,
      status: t.status,
      channelCount: t.channelCount,
      channelAmount: Money.format(t.channelAmount),
      centerCount: t.centerCount,
      centerAmount: Money.format(t.centerAmount),
      matchedCount: t.matchedCount,
      matchedAmount: Money.format(t.matchedAmount),
      diffCount: t.diffCount,
      diffAmount: Money.format(t.diffAmount),
      matchRate: t.matchRate ? Money.format(Money.mul(t.matchRate, 100), 2) : null,
      billSource: t.billSource,
      triggeredBy: t.triggeredBy,
      triggerType: t.triggerType,
      startedAt: t.startedAt,
      finishedAt: t.finishedAt,
      durationMs: t.durationMs,
      errorMessage: t.errorMessage,
      createdAt: t.createdAt,
    };
  }

  private toDiffView(d: any) {
    return {
      id: Number(d.id),
      taskId: Number(d.taskId),
      diffType: d.diffType,
      diffTypeLabel: DiffTypeLabel[d.diffType] || d.diffType,
      severity: d.severity,
      billDate: dayjs(d.billDate).format('YYYY-MM-DD'),
      channel: d.channel,
      appId: d.appId,
      payOrderNo: d.payOrderNo,
      merchantOrderNo: d.merchantOrderNo,
      channelTradeNo: d.channelTradeNo,
      centerAmount: d.centerAmount ? Money.format(d.centerAmount) : null,
      channelAmount: d.channelAmount ? Money.format(d.channelAmount) : null,
      diffAmount: Money.format(d.diffAmount),
      centerStatus: d.centerStatus,
      channelStatus: d.channelStatus,
      handleStatus: d.handleStatus,
      handleAction: d.handleAction,
      handler: d.handler,
      handleRemark: d.handleRemark,
      handledAt: d.handledAt,
      createdAt: d.createdAt,
    };
  }
}
