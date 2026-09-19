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

  /** 从渠道下载账单并入库（支持重复执行：以 uk_bill_line 幂等 upsert） */
  async fetchAndStore(params: {
    channel: string;
    billDate: string; // YYYY-MM-DD
    billType?: 'TRADE' | 'REFUND' | 'ALL';
    operator?: string;
    taskId?: bigint;
  }): Promise<StoreBillResult> {
    const adapter = await this.channelService.getAdapter(params.channel);
    let rows: BillRow[];
    try {
      rows = await adapter.downloadBill({ billDate: params.billDate, billType: params.billType || 'ALL' });
    } catch (e: any) {
      this.logger.error(`[bill] 下载 ${params.channel} ${params.billDate} 账单失败: ${e.message}`);
      throw new BizException(ErrorCode.RECONCILE_BILL_NOT_FOUND, e.message);
    }
    return this.store(rows, params.channel, adapter.mchId, params.billDate, params.operator, params.taskId);
  }

  /** 手动上传账单文件（渠道下载失败时的补拉手段） */
  async uploadAndStore(params: {
    channel: string;
    billDate: string;
    content: string;
    operator?: string;
    taskId?: bigint;
  }): Promise<StoreBillResult> {
    const adapter: any = await this.channelService.getAdapter(params.channel);
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
      rawFilePath = path.join(dir, `${channel}_${billDate}_${Date.now()}.csv`);
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
      targetId: `${channel}/${billDate}`,
      detail: `账单入库 ${channel} ${billDate}：新增 ${inserted} 条、更新 ${updated} 条，共 ${rows.length} 条`,
    });

    return { billDate, channel, mchId, total: rows.length, inserted, updated, rawFilePath };
  }

  /** 查询某日账单是否已拉取 */
  async hasBill(channel: string, billDate: string): Promise<number> {
    return this.prisma.channelBill.count({
      where: { channel, billDate: DateUtil.billDate(billDate) },
    });
  }

  /** 列出全部已配置的渠道（用于对账遍历） */
  async listActiveChannels(): Promise<string[]> {
    const rows = await this.prisma.channelConfig.findMany({
      where: { enabled: true, channel: { not: Channel.MOCK } },
      select: { channel: true },
      distinct: ['channel'],
    });
    const list = rows.map((r) => r.channel);
    if (!list.length) list.push(Channel.MOCK);
    return list;
  }
}
