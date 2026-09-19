/**
 * 统一错误码体系
 * 业务系统根据 code 做分支处理，message 仅用于排查（不保证稳定）
 */
export const ErrorCode = {
  /** 成功 */
  SUCCESS: 0,

  // ===== 1xxx 通用 =====
  PARAM_ERROR: 1001,
  SYSTEM_ERROR: 1002,
  DATA_NOT_FOUND: 1003,
  OPERATION_TOO_FREQUENT: 1004,
  FORBIDDEN: 1005,
  REQUEST_EXPIRED: 1006,
  /** 系统尚未完成安装向导 */
  INSTALL_REQUIRED: 1010,
  ALREADY_INSTALLED: 1011,

  // ===== 2xxx 鉴权与签名 =====
  APP_ID_NOT_FOUND: 2001,
  APP_DISABLED: 2002,
  SIGN_MISSING: 2003,
  SIGN_INVALID: 2004,
  TIMESTAMP_INVALID: 2005,
  NONCE_REPLAY: 2006,
  IP_NOT_ALLOWED: 2007,
  CHANNEL_NOT_ALLOWED: 2008,
  TOKEN_INVALID: 2009,
  TOKEN_EXPIRED: 2010,
  PERMISSION_DENIED: 2011,

  // ===== 3xxx 支付订单 =====
  ORDER_NOT_FOUND: 3001,
  ORDER_STATUS_INVALID: 3002,
  ORDER_ALREADY_PAID: 3003,
  ORDER_CLOSED: 3004,
  ORDER_EXPIRED: 3005,
  ORDER_AMOUNT_INVALID: 3006,
  ORDER_AMOUNT_EXCEED_LIMIT: 3007,
  ORDER_IDEMPOTENT_CONFLICT: 3008,
  ORDER_CLOSE_FAILED: 3009,

  // ===== 4xxx 退款 =====
  REFUND_NOT_FOUND: 4001,
  REFUND_AMOUNT_INVALID: 4002,
  REFUND_AMOUNT_EXCEED: 4003,
  REFUND_ORDER_NOT_PAID: 4004,
  REFUND_STATUS_INVALID: 4005,
  REFUND_CHANNEL_FAILED: 4006,
  REFUND_IDEMPOTENT_CONFLICT: 4007,

  // ===== 5xxx 渠道 =====
  CHANNEL_NOT_FOUND: 5001,
  CHANNEL_DISABLED: 5002,
  CHANNEL_CONFIG_INVALID: 5003,
  CHANNEL_REQUEST_FAILED: 5004,
  CHANNEL_RESPONSE_INVALID: 5005,
  CHANNEL_TRADE_NOT_EXIST: 5006,

  // ===== 6xxx 对账 =====
  RECONCILE_RUNNING: 6001,
  RECONCILE_TASK_NOT_FOUND: 6002,
  RECONCILE_BILL_NOT_FOUND: 6003,
  RECONCILE_BILL_PARSE_FAILED: 6004,
  RECONCILE_DIFF_NOT_FOUND: 6005,
  RECONCILE_DIFF_HANDLED: 6006,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorMessage: Record<number, string> = {
  [ErrorCode.SUCCESS]: 'success',
  [ErrorCode.PARAM_ERROR]: '参数错误',
  [ErrorCode.SYSTEM_ERROR]: '系统繁忙，请稍后重试',
  [ErrorCode.DATA_NOT_FOUND]: '数据不存在',
  [ErrorCode.OPERATION_TOO_FREQUENT]: '操作过于频繁',
  [ErrorCode.FORBIDDEN]: '禁止访问',
  [ErrorCode.REQUEST_EXPIRED]: '请求已过期',
  [ErrorCode.INSTALL_REQUIRED]: '系统尚未安装，请先完成安装向导',
  [ErrorCode.ALREADY_INSTALLED]: '系统已安装',

  [ErrorCode.APP_ID_NOT_FOUND]: 'AppId 不存在',
  [ErrorCode.APP_DISABLED]: 'AppId 已停用',
  [ErrorCode.SIGN_MISSING]: '缺少签名参数',
  [ErrorCode.SIGN_INVALID]: '签名校验失败',
  [ErrorCode.TIMESTAMP_INVALID]: '时间戳不合法',
  [ErrorCode.NONCE_REPLAY]: '请求重放（nonce 已使用）',
  [ErrorCode.IP_NOT_ALLOWED]: '来源 IP 不在白名单',
  [ErrorCode.CHANNEL_NOT_ALLOWED]: '该业务系统未开通此支付渠道',
  [ErrorCode.TOKEN_INVALID]: '登录态无效',
  [ErrorCode.TOKEN_EXPIRED]: '登录态已过期',
  [ErrorCode.PERMISSION_DENIED]: '权限不足',

  [ErrorCode.ORDER_NOT_FOUND]: '支付订单不存在',
  [ErrorCode.ORDER_STATUS_INVALID]: '订单状态不允许该操作',
  [ErrorCode.ORDER_ALREADY_PAID]: '订单已支付',
  [ErrorCode.ORDER_CLOSED]: '订单已关闭',
  [ErrorCode.ORDER_EXPIRED]: '订单已过期',
  [ErrorCode.ORDER_AMOUNT_INVALID]: '订单金额不合法',
  [ErrorCode.ORDER_AMOUNT_EXCEED_LIMIT]: '订单金额超出限额',
  [ErrorCode.ORDER_IDEMPOTENT_CONFLICT]: '幂等键冲突：相同业务单号参数不一致',
  [ErrorCode.ORDER_CLOSE_FAILED]: '关闭订单失败',

  [ErrorCode.REFUND_NOT_FOUND]: '退款单不存在',
  [ErrorCode.REFUND_AMOUNT_INVALID]: '退款金额不合法',
  [ErrorCode.REFUND_AMOUNT_EXCEED]: '退款金额超出可退金额',
  [ErrorCode.REFUND_ORDER_NOT_PAID]: '原订单未支付成功，不能退款',
  [ErrorCode.REFUND_STATUS_INVALID]: '退款单状态不允许该操作',
  [ErrorCode.REFUND_CHANNEL_FAILED]: '渠道退款失败',
  [ErrorCode.REFUND_IDEMPOTENT_CONFLICT]: '幂等键冲突：相同业务退款单号参数不一致',

  [ErrorCode.CHANNEL_NOT_FOUND]: '支付渠道配置不存在',
  [ErrorCode.CHANNEL_DISABLED]: '支付渠道已停用',
  [ErrorCode.CHANNEL_CONFIG_INVALID]: '支付渠道配置不完整',
  [ErrorCode.CHANNEL_REQUEST_FAILED]: '渠道请求失败',
  [ErrorCode.CHANNEL_RESPONSE_INVALID]: '渠道返回报文异常',
  [ErrorCode.CHANNEL_TRADE_NOT_EXIST]: '渠道侧订单不存在',

  [ErrorCode.RECONCILE_RUNNING]: '对账任务正在执行中',
  [ErrorCode.RECONCILE_TASK_NOT_FOUND]: '对账批次不存在',
  [ErrorCode.RECONCILE_BILL_NOT_FOUND]: '未找到渠道账单',
  [ErrorCode.RECONCILE_BILL_PARSE_FAILED]: '账单解析失败',
  [ErrorCode.RECONCILE_DIFF_NOT_FOUND]: '差异记录不存在',
  [ErrorCode.RECONCILE_DIFF_HANDLED]: '该差异已处理，不可重复操作',
};
