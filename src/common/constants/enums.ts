/** 支付渠道标识 */
export enum Channel {
  WECHAT = 'wechat',
  ALIPAY = 'alipay',
  UNIONPAY = 'unionpay',
  /** 本地模拟渠道：沙箱/联调自测用，不产生真实资金流 */
  MOCK = 'mock',

  // ============ 以下渠道已登记，但尚未实现适配器（adapter 未接入，配置不可保存）============
  /** 京东支付（京东科技开放平台）：一次对接京东 / 微信 / 支付宝钱包 */
  JD = 'jd',
  /** QQ 钱包（财付通）：生态内使用，需腾讯侧开通 */
  QQ = 'qq',
  /** 数字人民币：需运营机构（工行 / 建行等）白名单准入 */
  DIGITAL_RMB = 'digital_rmb',
  /** PayPal：跨境收单，需跨境主体与境外结算账户 */
  PAYPAL = 'paypal',
  /** 抖音支付：仅抖音小程序「担保支付」生态内可用，未开放通用收单接口 */
  DOUYIN = 'douyin',
}

/** 支付方式（交易类型） */
export enum TradeType {
  /** 微信小程序 / 公众号内支付 */
  JSAPI = 'JSAPI',
  /** 微信/支付宝 扫码支付 */
  NATIVE = 'NATIVE',
  /** App 内支付 */
  APP = 'APP',
  /** 手机浏览器网页支付 */
  MWEB = 'MWEB',
  /** 支付宝电脑网站支付 */
  PC = 'PC',
  /** 支付宝当面付（商家扫码枪扫用户付款码） */
  FACE_TO_FACE = 'FACE_TO_FACE',
}

/** 支付订单状态流转：
 *  CREATED ──> PAYING ──> SUCCESS ──> REFUNDING ──> REFUNDED
 *     │           │
 *     └──> CLOSED <┘        FAILED / REVOKED（渠道侧撤销）
 */
export enum PayOrderStatus {
  /** 已创建，等待用户支付 */
  CREATED = 'CREATED',
  /** 支付中（用户已唤起支付，未收到最终结果） */
  PAYING = 'PAYING',
  /** 支付成功（终态） */
  SUCCESS = 'SUCCESS',
  /** 已关闭（未支付主动关闭 / 超时关闭，终态） */
  CLOSED = 'CLOSED',
  /** 已撤销（渠道侧撤销，终态） */
  REVOKED = 'REVOKED',
  /** 支付失败（渠道明确返回失败，终态） */
  FAILED = 'FAILED',
  /** 部分退款中 */
  REFUNDING = 'REFUNDING',
  /** 已全额退款（终态） */
  REFUNDED = 'REFUNDED',
}

/** 终态：进入后不可再变更支付结果 */
export const PAY_FINAL_STATUS = [
  PayOrderStatus.SUCCESS,
  PayOrderStatus.CLOSED,
  PayOrderStatus.REVOKED,
  PayOrderStatus.FAILED,
  PayOrderStatus.REFUNDED,
];

/** 退款单状态 */
export enum RefundStatus {
  /** 已受理，待渠道处理 */
  CREATED = 'CREATED',
  /** 退款中 */
  PROCESSING = 'PROCESSING',
  /** 退款成功（终态） */
  SUCCESS = 'SUCCESS',
  /** 退款失败（终态，可重试） */
  FAILED = 'FAILED',
  /** 退款关闭（终态） */
  CLOSED = 'CLOSED',
}

/** 通知状态 */
export enum NotifyStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  /** 超过最大重试次数，进入死信需人工介入 */
  DEAD = 'DEAD',
}

/** 通知业务类型 */
export enum NotifyBizType {
  PAY = 'PAY',
  REFUND = 'REFUND',
}

/** 对账差异类型 */
export enum DiffType {
  /** 长款：渠道有、支付中心无（钱多了，需补单或退回） */
  CHANNEL_ONLY = 'CHANNEL_ONLY',
  /** 短款：支付中心有、渠道无（钱没到账，需查渠道） */
  CENTER_ONLY = 'CENTER_ONLY',
  /** 金额不符 */
  AMOUNT_DIFF = 'AMOUNT_DIFF',
  /** 状态不符：一方成功一方关闭/失败 */
  STATUS_DIFF = 'STATUS_DIFF',
  /** 重复支付：同一业务订单号出现多笔成功 */
  DUPLICATE = 'DUPLICATE',
  /** 退款差异 */
  REFUND_DIFF = 'REFUND_DIFF',
}

export const DiffTypeLabel: Record<string, string> = {
  CHANNEL_ONLY: '长款（渠道有/中心无）',
  CENTER_ONLY: '短款（中心有/渠道无）',
  AMOUNT_DIFF: '金额不符',
  STATUS_DIFF: '状态不符',
  DUPLICATE: '重复支付',
  REFUND_DIFF: '退款差异',
};

/** 差异处理状态 */
export enum HandleStatus {
  /** 待处理 */
  PENDING = 'PENDING',
  /** 已人工确认平账 */
  PROCESSED = 'PROCESSED',
  /** 已补单 */
  COMPENSATED = 'COMPENSATED',
  /** 已冲正 */
  REVERSED = 'REVERSED',
  /** 已忽略（确认无风险） */
  IGNORED = 'IGNORED',
}

export const HandleStatusLabel: Record<string, string> = {
  PENDING: '待处理',
  PROCESSED: '已确认平账',
  COMPENSATED: '已补单',
  REVERSED: '已冲正',
  IGNORED: '已忽略',
};

/** 对账周期 */
export enum ReconcilePeriod {
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
  CUSTOM = 'CUSTOM',
}

/** 对账任务状态 */
export enum ReconcileStatus {
  RUNNING = 'RUNNING',
  /** 全部平账 */
  SUCCESS = 'SUCCESS',
  /** 存在差异 */
  PARTIAL = 'PARTIAL',
  /** 执行失败 */
  FAILED = 'FAILED',
}

/** 管理后台角色 */
export enum AdminRole {
  SUPER = 'SUPER',
  FINANCE = 'FINANCE',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
}
