/**
 * 日期口径工具
 *
 * 关键区分（踩过坑）：
 *  1) 「账单日」写/读 MySQL DATE 列：必须用 UTC 午夜构造 Date。
 *     若用本地午夜 `new Date('2026-09-19T00:00:00')`，Prisma 发送时按 UTC 序列化
 *     → 东八区变成 2026-09-18T16:00:00Z → DATE 列落库为 2026-09-18（整体偏一天）。
 *  2) 「订单时间范围」过滤 DATETIME 列（paidAt/createdAt）：必须用本地区间，
 *     因为读写都带时区转换，本地午夜才是业务意义上的当天 00:00。
 */
export class DateUtil {
  /** 账单日 -> 用于 DATE 列的 Date（UTC 午夜，落库即为该日） */
  static billDate(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`);
  }

  /** 本地自然日区间 [00:00:00.000, 23:59:59.999]，用于 DATETIME 列范围查询 */
  static localDayRange(day: string): { start: Date; end: Date } {
    return {
      start: new Date(`${day}T00:00:00.000`),
      end: new Date(`${day}T23:59:59.999`),
    };
  }

  /** 本地日期 YYYY-MM-DD（不要用 toISOString，那是 UTC 会跨零点错位） */
  static localDay(d: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** 昨天（本地口径） */
  static yesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return DateUtil.localDay(d);
  }
}
