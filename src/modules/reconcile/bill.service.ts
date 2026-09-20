import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelService } from '../channel/channel.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { Money } from '../../common/utils/money';
import { DateUtil } from '../../common/utils/date.util';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { Channel } from '../../common/constants/enums';
import { BillRow } from '../channel/channel.types';

export interface StoreBillResult {
  billDate: string;
  channel: string;
  mchId: string;
  total: number;
  inserted: number;
  updated: number;
  rawFilePath?: string;
}

/** 账单拉取目标 = 一个渠道商户号配置（主体隔离后同一渠道会有多个） */
export interface BillTarget {
  configId: number;
  channel: string;
  name: string;
  mchId: string;
  scene: string | null;
  legalEntityId: number | null;
  categories: string[];
}

/**
 * 账单服务：负责「拉取/上传 -> 解析 -> 标准化入库」
 * 入库后数据落在 channel_bill，供对账引擎核对（需求 3.2.3 自动拉取渠道账单 / 账单解析与入库）
 */
@Injectable()
export class BillService {
  private readonly logger = new Logger(BillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelService: ChannelService,
    private readonly opLog: OperationLogService,
  ) {}

  /**
   * 从渠道下载账单并入库（支持重复执行：以 uk_bill_line 幂等 upsert）
   *
   * configId 用于指定具体商户号。多商户号并存时必须指定 ——
   * 不指定只会拿到该渠道 priority 最高的默认号，其余主体的账单被静默跳过。
   */
  async fetchAndStore(params: {
    channel: string;
    billDate: string; // YYYY-MM-DD
    billType?: 'TRADE' | 'REFUND' | 'ALL';
    /** 指定渠道配置（商户号）；不指定时取该渠道默认配置 */
    configId?: number;
    operator?: string;
    taskId?: bigint;
  }): Promise<StoreBillResult> {
    const adapter = params.configId
      ? await this.channelService.getAdapterByConfigId(params.configId)
      : await this.channelService.getAdapter(params.channel);
    let rows: BillRow[];
    try {
      rows = await adapter.downloadBill({ billDate: params.billDate, billType: params.billType || 'ALL' });
    } catch (e: any) {
      this.logger.error(`[bill] 下载 ${params.channel}/${adapter.mchId} ${params.billDate} 账单失败: ${e.message}`);
      throw new BizException(ErrorCode.RECONCILE_BILL_NOT_FOUND, e.message);
    }
    return this.store(rows, params.channel, adapter.mchId, params.billDate, params.operator, params.taskId);
  }

  /** 手动上传账单文件（渠道下载失败时的补拉手段） */
  async uploadAndStore(params: {
    channel: string;
    billDate: string;
    content: string;
    /** 归属商户号：多渠道商户号时必须指定，否则会全部记到默认号名下 */
    mchId?: string;
    operator?: string;
    taskId?: bigint;
  }): Promise<StoreBillResult> {
    const mchId = await this.resolveUploadMchId(params.channel, params.mchId);
    const adapter: any = mchId
      ? await this.channelService.getAdapterByMchId(params.channel, mchId)
      : await this.channelService.getAdapter(params.channel);
    if (typeof adapter.parseBillCsv !== 'function') {
      throw new BizException(ErrorCode.RECONCILE_BILL_PARSE_FAILED, `渠道 ${params.channel} 不支持账单文件解析`);
    }
    let rows: BillRow[];
    try {
      rows = adapter.parseBillCsv(params.content, params.billDate);
    } catch (e: any) {
      throw new BizException(ErrorCode.RECONCILE_BILL_PARSE_FAILED, e.message);
    }
    return this.store(rows, params.channel, adapter.mchId, params.billDate, params.operator, params.taskId, params.content);
  }

  /**
   * 解析手动上传归属的商户号
   * 该渠道只有一个商户号时可省略；有多个时省略会串号（全记到默认号名下），故强制要求指定。
   */
  private async resolveUploadMchId(channel: string, mchId?: string): Promise<string | undefined> {
    if (mchId) return mchId;
    const rows = await this.prisma.channelConfig.findMany({
      where: { channel, enabled: true },
      select: { mchId: true },
      distinct: ['mchId'],
    });
    if (rows.length > 1) {
      throw new BizException(
        ErrorCode.PARAM_ERROR,
        `渠道 ${channel} 下有 ${rows.length} 个商户号，上传账单必须指定归属商户号`,
      );
    }
    return rows[0]?.mchId;
  }

  // ==================== 全量遍历 ====================

  /**
   * 全量拉取：遍历所有启用的渠道配置（商户号）逐个下载账单
   *
   * 主体隔离后「一个渠道 = 多个商户号」是常态，按渠道维度拉单只会覆盖默认号。
   * 单个商户号失败不影响其余（记日志继续），否则一个号配置错误会拖垮全部对账。
   */
  async fetchAllAndStore(params: {
    billDate: string;
    billType?: 'TRADE' | 'REFUND' | 'ALL';
    operator?: string;
    taskId?: bigint;
    /** 已有账单也强制重新下载（按 uk_bill_line upsert，不会重复） */
    force?: boolean;
    /** 只拉指定渠道（不传 = 全部渠道） */
    channel?: string;
  }): Promise<{
    billDate: string;
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    results: (StoreBillResult & { configId: number })[];
    errors: { configId: number; channel: string; mchId: string; error: string }[];
  }> {
    const targets = (await this.listBillTargets()).filter((t) => !params.channel || t.channel === params.channel);
    const results: (StoreBillResult & { configId: number })[] = [];
    const errors: { configId: number; channel: string; mchId: string; error: string }[] = [];
    let skipped = 0;

    for (const t of targets) {
      if (!params.force) {
        const count = await this.hasBillForMch(t.channel, t.mchId, params.billDate);
        if (count > 0) {
          skipped++;
          continue;
        }
      }
      try {
        const r = await this.fetchAndStore({
          channel: t.channel,
          billDate: params.billDate,
          billType: params.billType,
          configId: t.configId,
          operator: params.operator,
          taskId: params.taskId,
        });
        results.push({ ...r, configId: t.configId });
      } catch (e: any) {
        this.logger.error(`[bill] 全量拉取 ${t.channel}/${t.mchId} ${params.billDate} 失败: ${e.message}`);
        errors.push({ configId: t.configId, channel: t.channel, mchId: t.mchId, error: e.message });
      }
    }

    if (errors.length) {
      this.logger.warn(
        `[bill] ${params.billDate} 全量拉取完成：成功 ${results.length} / 失败 ${errors.length}，失败商户号：${errors
          .map((e) => `${e.channel}/${e.mchId}`)
          .join(', ')}`,
      );
    }
    return {
      billDate: params.billDate,
      total: targets.length,
      succeeded: results.length,
      failed: errors.length,
      skipped,
      results,
      errors,
    };
  }

  /**
   * 列出所有需要拉账单的商户号（渠道配置）
   * 个人收款码与 Mock 无渠道账单，不参与自动对账遍历。
   */
  async listBillTargets(): Promise<BillTarget[]> {
    const rows = await this.prisma.channelConfig.findMany({
      where: { enabled: true, channel: { notIn: [Channel.MOCK, Channel.PERSONAL_QR] } },
      orderBy: [{ channel: 'asc' }, { priority: 'desc' }],
    });
    return rows.map((r) => ({
      configId: Number(r.id),
      channel: r.channel,
      name: r.name,
      mchId: r.mchId,
      scene: r.scene || null,
      legalEntityId: r.legalEntityId ? Number(r.legalEntityId) : null,
      categories: (r.categories as string[]) || [],
    }));
  }

  /** 标准化入库 */
  private async store(
    rows: BillRow[],
    channel: string,
    mchId: string,
    billDate: string,
    operator = 'SYSTEM',
    taskId?: bigint,
    rawContent?: string,
  ): Promise<StoreBillResult> {
    // 原始账单落盘归档（数据保留 3 年 + 便于审计追溯）
    let rawFilePath: string | undefined;
    if (rawContent) {
      const dir = path.resolve(process.env.BILL_STORE_DIR || './storage/bills');
      fs.mkdirSync(dir, { recursive: true });
      // 文件名带商户号：多商户号并存时不带会互相混淆，归档追溯分不清是哪一家的账单
      rawFilePath = path.join(dir, `${channel}_${mchId}_${billDate}_${Date.now()}.csv`);
      fs.writeFileSync(rawFilePath, rawContent, 'utf8');
    }

    // 归属业务系统回填：用 outTradeNo 反查支付订单
    const payOrderNos = rows.map((r) => r.outTradeNo).filter(Boolean);
    const orders = await this.prisma.payOrder.findMany({
      where: { payOrderNo: { in: payOrderNos } },
      select: { payOrderNo: true, appId: true, merchantOrderNo: true },
    });
    const orderMap = new Map(orders.map((o) => [o.payOrderNo, o]));

    const billDateObj = DateUtil.billDate(billDate); // DATE 列：UTC 午夜，落库即为该日
    let inserted = 0;
    let updated = 0;

    // 分批入库，避免单次事务过大
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      for (const r of chunk) {
        const order = r.outTradeNo ? orderMap.get(r.outTradeNo) : undefined;
        const data = {
          billDate: billDateObj,
          channel,
          mchId,
          billType: r.billType || 'TRADE',
          tradeNo: r.tradeNo,
          outTradeNo: r.outTradeNo || null,
          merchantOrderNo: order?.merchantOrderNo || null,
          appId: order?.appId || null,
          amount: Money.round(r.amount, 2),
          refundAmount: Money.round(r.refundAmount || 0, 2),
          netAmount: Money.round(Money.sub(Money.D(r.amount), Money.D(r.refundAmount || 0)), 2),
          tradeStatus: r.tradeStatus,
          rawStatus: r.rawStatus,
          tradeTime: r.tradeTime,
          payerId: r.payerId,
          subject: r.subject,
          tradeType: r.tradeType,
          fee: r.fee ? Money.round(r.fee, 2) : null,
          raw: r.raw ?? undefined,
        };

        // upsert：以 uk_bill_line 为唯一键，重复拉取只更新（原子操作，避免并发下 create 撞唯一键）
        const key = {
          billDate: billDateObj,
          channel,
          mchId,
          tradeNo: r.tradeNo,
          billType: r.billType || 'TRADE',
        };
        const before = await this.prisma.channelBill.findUnique({
          where: { uk_bill_line: key },
          select: { id: true },
        });
        await this.prisma.channelBill.upsert({
          where: { uk_bill_line: key },
          create: { ...data, taskId: taskId ?? null },
          update: { ...data, taskId: taskId ?? undefined },
        });
        if (before) updated++;
        else inserted++;
      }
    }

    await this.opLog.write({
      operator,
      operatorType: operator === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
      module: 'reconcile',
      action: 'fetch_bill',
      targetId: `${channel}/${mchId}/${billDate}`,
      detail: `账单入库 ${channel}/${mchId} ${billDate}：新增 ${inserted} 条、更新 ${updated} 条，共 ${rows.length} 条`,
    });

    return { billDate, channel, mchId, total: rows.length, inserted, updated, rawFilePath };
  }

  /** 查询某日账单是否已拉取（按渠道，不区分商户号：仅用于粗粒度展示） */
  async hasBill(channel: string, billDate: string): Promise<number> {
    return this.prisma.channelBill.count({
      where: { channel, billDate: DateUtil.billDate(billDate) },
    });
  }

  /**
   * 查询某商户号某日账单是否已拉取
   *
   * 判缺必须精确到商户号：只按渠道判断时，只要默认号有账单就认为"已就绪"，
   * 其余商户号永远不会触发下载 —— 这是多商户号下漏对账的直接原因。
   */
  async hasBillForMch(channel: string, mchId: string, billDate: string): Promise<number> {
    return this.prisma.channelBill.count({
      where: { channel, mchId, billDate: DateUtil.billDate(billDate) },
    });
  }

  /** 列出全部已配置的渠道（用于对账遍历）：个人收款码无渠道账单，不参与自动对账 */
  async listActiveChannels(): Promise<string[]> {
    const rows = await this.prisma.channelConfig.findMany({
      where: { enabled: true, channel: { notIn: [Channel.MOCK, Channel.PERSONAL_QR] } },
      select: { channel: true },
      distinct: ['channel'],
    });
    const list = rows.map((r) => r.channel);
    if (!list.length) list.push(Channel.MOCK);
    return list;
  }
}
