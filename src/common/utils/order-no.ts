import * as crypto from 'crypto';
import dayjs from 'dayjs';

/**
 * 单号生成规则（全局唯一、可读、可大致排序）：
 *   支付订单号  P + yyyyMMddHHmmss + 8 位随机   (如 P20260919103012a3f9c1b2)
 *   退款单号    R + yyyyMMddHHmmss + 8 位随机
 *   对账批次号  RC + yyyyMMdd + 6 位随机
 */
export class OrderNoUtil {
  private static seq = 0;

  /** 进程内自增序号（同一毫秒内进一步降低碰撞概率） */
  private static nextSeq(): string {
    OrderNoUtil.seq = (OrderNoUtil.seq + 1) % 100000;
    return OrderNoUtil.seq.toString().padStart(5, '0');
  }

  private static rand(len: number): string {
    return crypto.randomBytes(len).toString('hex').slice(0, len);
  }

  static payOrderNo(): string {
    return `P${dayjs().format('YYYYMMDDHHmmss')}${OrderNoUtil.nextSeq()}${OrderNoUtil.rand(3)}`;
  }

  static refundNo(): string {
    return `R${dayjs().format('YYYYMMDDHHmmss')}${OrderNoUtil.nextSeq()}${OrderNoUtil.rand(3)}`;
  }

  static reconcileTaskNo(date?: string): string {
    const d = date || dayjs().format('YYYYMMDD');
    return `RC${d}${OrderNoUtil.rand(6)}`;
  }

  static notifyTraceId(): string {
    return crypto.randomUUID().replace(/-/g, '');
  }
}
