import Decimal from 'decimal.js';

// 全局精度：金额运算统一 2 位小数，四舍五入
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MoneyLike = string | number | Decimal;

/**
 * 金额工具 —— 所有涉及钱的计算必须走这里，禁止使用 JS number 直接加减
 */
export class Money {
  static D(v: MoneyLike = 0): Decimal {
    if (v instanceof Decimal) return v;
    if (v === null || v === undefined || v === '') return new Decimal(0);
    return new Decimal(v);
  }

  static add(a: MoneyLike, b: MoneyLike): Decimal {
    return Money.D(a).plus(Money.D(b));
  }

  static sub(a: MoneyLike, b: MoneyLike): Decimal {
    return Money.D(a).minus(Money.D(b));
  }

  static mul(a: MoneyLike, b: MoneyLike): Decimal {
    return Money.D(a).times(Money.D(b));
  }

  static div(a: MoneyLike, b: MoneyLike): Decimal {
    return Money.D(a).div(Money.D(b));
  }

  /** 保留 2 位小数（四舍五入） */
  static round(v: MoneyLike, dp = 2): Decimal {
    return Money.D(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
  }

  /** 是否为合法金额：正数、最多 2 位小数 */
  static isValid(v: unknown): boolean {
    if (v === null || v === undefined || v === '') return false;
    let d: Decimal;
    try {
      d = new Decimal(v as any);
    } catch {
      return false;
    }
    if (d.isNaN() || !d.isFinite()) return false;
    if (d.lte(0)) return false;
    // 小数位不得超过 2 位
    return d.decimalPlaces() <= 2;
  }

  /** 金额相等（按分比较，避免浮点误差） */
  static eq(a: MoneyLike, b: MoneyLike): boolean {
    return Money.D(a).toDecimalPlaces(2).equals(Money.D(b).toDecimalPlaces(2));
  }

  /** a > b */
  static gt(a: MoneyLike, b: MoneyLike): boolean {
    return Money.D(a).gt(Money.D(b));
  }

  /** a >= b */
  static gte(a: MoneyLike, b: MoneyLike): boolean {
    return Money.D(a).gte(Money.D(b));
  }

  /** a < b */
  static lt(a: MoneyLike, b: MoneyLike): boolean {
    return Money.D(a).lt(Money.D(b));
  }

  /** 元 -> 分（整数），用于渠道下单 */
  static toFen(v: MoneyLike): number {
    return Money.round(v, 2).times(100).toNumber();
  }

  /** 分 -> 元（Decimal） */
  static fromFen(v: number | string): Decimal {
    return Money.D(v).div(100).toDecimalPlaces(2);
  }

  /** 格式化：1234.5 -> "1234.50" */
  static format(v: MoneyLike, dp = 2): string {
    return Money.D(v).toFixed(dp);
  }

  /** 转 number（仅用于统计展示，禁止用于金额比较） */
  static toNumber(v: MoneyLike): number {
    return Money.D(v).toNumber();
  }
}
