import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MerchantService } from '../merchant/merchant.service';
import { NotifyBizType, NotifyStatus } from '../../common/constants/enums';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { signNotify, NOTIFY_SIGN_HEADER } from '../auth/signature.util';
import { OperationLogService } from '../../common/log/operation-log.service';

/** 默认重试退避阶梯（秒）：1s,5s,30s,5min,30min,1h,2h,6h */
const DEFAULT_BACKOFF = [1, 5, 30, 300, 1800, 3600, 7200, 21600];

export interface NotifyPayload {
  [key: string]: any;
}

/**
 * 异步通知中心
 * 职责：
 *  1) 支付/退款结果以「可靠通知」方式送达业务系统（需求 3.1 异步通知、5.数据一致性）
 *  2) 指数退避重试，超过最大次数进入 DEAD 死信，由后台人工重投
 *  3) 通知内容带 HMAC 签名，业务系统可校验来源与完整性
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantService: MerchantService,
    private readonly opLog: OperationLogService,
  ) {}

  private get backoff(): number[] {
    const raw = (process.env.NOTIFY_BACKOFF || '').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
    return raw.length ? raw : DEFAULT_BACKOFF;
  }

  private get maxRetry(): number {
    return Number(process.env.NOTIFY_MAX_RETRY || 8);
  }

  /**
   * 入队 + 立刻尝试首次投递
   * 幂等：同一 bizNo 只允许存在一条活跃通知任务（PENDING/FAILED），避免重复通知
   */
  async enqueue(params: {
    bizType: NotifyBizType;
    bizNo: string;
    appId: string;
    payload: NotifyPayload;
    notifyUrl?: string;
  }): Promise<number> {
    const app = await this.merchantService.getSecret(params.appId);
    const url = params.notifyUrl || (await this.resolveUrl(params.bizType, params.appId));
    if (!url) {
      this.logger.warn(`[notify] ${params.appId} 未配置通知地址，跳过通知 bizNo=${params.bizNo}`);
      return 0;
    }

    // 去重：已有活跃任务则复用
    const exist = await this.prisma.notifyTask.findFirst({
      where: { bizType: params.bizType, bizNo: params.bizNo, status: { in: [NotifyStatus.PENDING, NotifyStatus.FAILED] } },
    });
    let taskId: bigint;
    if (exist) {
      await this.prisma.notifyTask.update({
        where: { id: exist.id },
        data: { payload: params.payload as any, notifyUrl: url },
      });
      taskId = exist.id;
    } else {
      const created = await this.prisma.notifyTask.create({
        data: {
          bizType: params.bizType,
          bizNo: params.bizNo,
          appId: params.appId,
          notifyUrl: url,
          payload: params.payload as any,
          status: NotifyStatus.PENDING,
          maxRetry: this.maxRetry,
          nextRetryAt: new Date(),
        },
      });
      taskId = created.id;
    }

    await this.deliver(taskId);
    return Number(taskId);
  }

  private async resolveUrl(bizType: NotifyBizType, appId: string): Promise<string | undefined> {
    const row = await this.prisma.merchantApp.findUnique({ where: { appId } });
    if (!row) return undefined;
    return bizType === NotifyBizType.PAY ? row.payNotifyUrl : row.refundNotifyUrl || row.payNotifyUrl;
  }

  /** 投递单条通知 */
  private async deliver(taskId: bigint): Promise<boolean> {
    const task = await this.prisma.notifyTask.findUnique({ where: { id: taskId } });
    if (!task) return false;
    if (task.status === NotifyStatus.SUCCESS) return true;

    const app = await this.merchantService.getSecret(task.appId);
    const body = task.payload as any;
    const { timestamp, nonce, sign } = signNotify({ appId: task.appId, body, secret: app.appSecret });

    try {
      const resp = await axios.post(task.notifyUrl, body, {
        timeout: Number(process.env.NOTIFY_TIMEOUT_MS || 5000),
        headers: {
          'Content-Type': 'application/json',
          [NOTIFY_SIGN_HEADER.appId]: task.appId,
          [NOTIFY_SIGN_HEADER.timestamp]: timestamp,
          [NOTIFY_SIGN_HEADER.nonce]: nonce,
          [NOTIFY_SIGN_HEADER.sign]: sign,
          'X-Pay-Biz-Type': task.bizType,
        },
        // 业务系统可能返回非 2xx，此处不抛异常，统一按「是否含成功标识」判断
        validateStatus: () => true,
      });

      const ok = this.isSuccessResponse(resp.data);
      if (ok) {
        await this.prisma.notifyTask.update({
          where: { id: taskId },
          data: {
            status: NotifyStatus.SUCCESS,
            retryCount: task.retryCount + 1,
            lastStatusCode: resp.status,
            lastResponse: this.truncate(resp.data),
            deliveredAt: new Date(),
            nextRetryAt: null,
          },
        });
        this.logger.log(`[notify] 送达成功 bizNo=${task.bizNo} 第 ${task.retryCount + 1} 次`);
        return true;
      }

      await this.markFailed(taskId, task.retryCount, resp.status, this.truncate(resp.data), '业务系统未返回成功标识');
      return false;
    } catch (e: any) {
      await this.markFailed(
        taskId,
        task.retryCount,
        e.response?.status,
        this.truncate(e.response?.data),
        e.message,
      );
      return false;
    }
  }

  /** 业务系统成功标识：{"code":0} 或 {"success":true} 或 文本 SUCCESS */
  private isSuccessResponse(data: any): boolean {
    if (typeof data === 'string') {
      const s = data.trim().toUpperCase();
      return s === 'SUCCESS' || s === 'OK' || s.includes('SUCCESS');
    }
    if (data && typeof data === 'object') {
      if (data.code === 0 || data.code === '0') return true;
      if (data.success === true || data.errcode === 0) return true;
      if (typeof data.data === 'string' && data.data.trim().toUpperCase() === 'SUCCESS') return true;
    }
    return false;
  }

  private async markFailed(
    taskId: bigint,
    retryCount: number,
    statusCode?: number,
    response?: string,
    error?: string,
  ): Promise<void> {
    const next = retryCount + 1;
    const max = this.maxRetry;
    const isDead = next >= max;
    const delay = this.backoff[Math.min(next - 1, this.backoff.length - 1)] || this.backoff[this.backoff.length - 1];

    await this.prisma.notifyTask.update({
      where: { id: taskId },
      data: {
        status: isDead ? NotifyStatus.DEAD : NotifyStatus.FAILED,
        retryCount: next,
        lastStatusCode: statusCode,
        lastResponse: response,
        lastError: this.truncate(error),
        nextRetryAt: isDead ? null : new Date(Date.now() + delay * 1000),
      },
    });

    if (isDead) {
      const task = await this.prisma.notifyTask.findUnique({ where: { id: taskId } });
      this.logger.error(
        `[notify] 通知进入死信 bizNo=${task?.bizNo} url=${task?.notifyUrl} 最后错误=${error || response}`,
      );
      await this.opLog.write({
        operator: 'SYSTEM',
        operatorType: 'SYSTEM',
        module: 'notify',
        action: 'dead_letter',
        targetId: task?.bizNo,
        detail: `通知失败 ${max} 次进入死信，需人工重投：${task?.notifyUrl}`,
        result: 'FAILED',
      });
    }
  }

  /**
   * 定时扫描待重试通知（每 20 秒）
   * 单实例/多实例均可运行：更新时用 status 条件保证不会被重复捞取
   */
  @Cron('*/20 * * * * *')
  async retryPending(): Promise<void> {
    const tasks = await this.prisma.notifyTask.findMany({
      where: {
        status: { in: [NotifyStatus.PENDING, NotifyStatus.FAILED] },
        nextRetryAt: { lte: new Date() },
      },
      take: 100,
      orderBy: { nextRetryAt: 'asc' },
    });
    if (!tasks.length) return;
    for (const t of tasks) {
      await this.deliver(t.id).catch((e) => this.logger.error(`[notify] 重试异常 ${t.bizNo}: ${e.message}`));
    }
  }

  /** 后台人工重投（死信/失败任务） */
  async redeliver(taskId: number, operator: string): Promise<void> {
    const task = await this.prisma.notifyTask.findUnique({ where: { id: BigInt(taskId) } });
    if (!task) throw new Error('通知任务不存在');
    await this.prisma.notifyTask.update({
      where: { id: BigInt(taskId) },
      data: { status: NotifyStatus.PENDING, retryCount: 0, nextRetryAt: new Date() },
    });
    await this.opLog.write({
      operator,
      operatorType: 'ADMIN',
      module: 'notify',
      action: 'redeliver',
      targetId: task.bizNo,
      detail: `人工重投通知 -> ${task.notifyUrl}`,
    });
    await this.deliver(BigInt(taskId));
  }

  async list(params: {
    bizType?: string;
    bizNo?: string;
    appId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const where: any = {};
    if (params.bizType) where.bizType = params.bizType;
    if (params.bizNo) where.bizNo = { contains: params.bizNo };
    if (params.appId) where.appId = params.appId;
    if (params.status) where.status = params.status;

    const [list, total] = await Promise.all([
      this.prisma.notifyTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notifyTask.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  private truncate(v: any): string | undefined {
    if (v === undefined || v === null) return undefined;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 1000 ? s.slice(0, 1000) : s;
  }
}

/** 供外部构造通知内容的辅助（SDK 文档中使用） */
export function buildPayNotifyPayload(p: {
  appId: string;
  payOrderNo: string;
  merchantOrderNo: string;
  amount: string;
  paidAmount?: string;
  channel: string;
  channelTxnId?: string;
  status: string;
  paidAt?: Date;
  subject: string;
  attach?: string;
}): NotifyPayload {
  return {
    appId: p.appId,
    payOrderNo: p.payOrderNo,
    merchantOrderNo: p.merchantOrderNo,
    amount: p.amount,
    paidAmount: p.paidAmount ?? p.amount,
    channel: p.channel,
    channelTxnId: p.channelTxnId,
    status: p.status,
    paidAt: p.paidAt?.toISOString(),
    subject: p.subject,
    attach: p.attach,
    notifyTime: new Date().toISOString(),
    nonce: CryptoUtil.randomString(16),
  };
}

export function buildRefundNotifyPayload(p: {
  appId: string;
  refundNo: string;
  merchantRefundNo: string;
  payOrderNo: string;
  merchantOrderNo?: string;
  refundAmount: string;
  status: string;
  refundedAt?: Date;
  reason?: string;
  attach?: string;
}): NotifyPayload {
  return {
    appId: p.appId,
    refundNo: p.refundNo,
    merchantRefundNo: p.merchantRefundNo,
    payOrderNo: p.payOrderNo,
    merchantOrderNo: p.merchantOrderNo,
    refundAmount: p.refundAmount,
    status: p.status,
    refundedAt: p.refundedAt?.toISOString(),
    reason: p.reason,
    attach: p.attach,
    notifyTime: new Date().toISOString(),
    nonce: CryptoUtil.randomString(16),
  };
}
