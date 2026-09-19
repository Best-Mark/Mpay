import { Channel, TradeType } from '../../common/constants/enums';

/** 下单入参（渠道无关） */
export interface CreatePaymentParams {
  payOrderNo: string;
  merchantOrderNo: string;
  amount: string; // 元，2 位小数字符串
  subject: string;
  body?: string;
  attach?: string;
  tradeType: TradeType;
  clientIp?: string;
  /** 付款者标识（微信 openid / 支付宝 buyer_id），JSAPI 必传 */
  payerId?: string;
  expireAt?: Date;
  notifyUrl: string;
  appId: string;
}

/** 下单结果：payParams 直接返回给业务系统用于唤起支付 */
export interface CreatePaymentResult {
  /** 渠道交易号（微信 prepay_id 时可能无，用 channelTxnId 表示已生成的渠道单号） */
  channelTxnId?: string;
  /** 唤起支付所需的参数集合，原样返回业务系统 */
  payParams: Record<string, any>;
  /** 渠道原始响应 */
  raw?: any;
}

/** 查单结果 */
export interface QueryPaymentResult {
  /** 是否存在（渠道侧未创建订单时返回 false） */
  exist: boolean;
  /** 归一化状态 */
  status: 'SUCCESS' | 'CLOSED' | 'REVOKED' | 'PAYING' | 'FAILED' | 'REFUNDING' | 'REFUNDED' | 'REFUND';
  channelTxnId?: string;
  payerId?: string;
  /** 实付金额（元） */
  amount?: string;
  paidAt?: Date;
  raw?: any;
}

export interface RefundParams {
  refundNo: string;
  payOrderNo: string;
  channelTxnId?: string;
  /** 原订单金额（元） */
  payAmount: string;
  /** 本次退款金额（元） */
  refundAmount: string;
  reason?: string;
  notifyUrl?: string;
}

export interface RefundResult {
  /** 渠道退款单号 */
  channelRefundId?: string;
  /** 归一化状态 */
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CLOSED';
  /** 渠道原始状态 */
  channelStatus?: string;
  fundsAccount?: string;
  failReason?: string;
  raw?: any;
}

export interface QueryRefundResult {
  exist: boolean;
  channelRefundId?: string;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'CLOSED';
  channelStatus?: string;
  amount?: string;
  refundedAt?: Date;
  failReason?: string;
  raw?: any;
}

/** 账单行（渠道无关，解析后统一结构） */
export interface BillRow {
  /** 渠道交易号 */
  tradeNo: string;
  /** 商户订单号（= 支付中心订单号） */
  outTradeNo: string;
  /** 交易金额（元），支付为正 */
  amount: string;
  /** 退款金额（元），无退款为 0 */
  refundAmount?: string;
  /** 归一化状态 */
  tradeStatus: 'SUCCESS' | 'CLOSED' | 'REVOKED' | 'PAYING' | 'REFUND' | 'FAILED';
  /** 渠道原始状态 */
  rawStatus?: string;
  tradeTime?: Date;
  payerId?: string;
  subject?: string;
  tradeType?: string;
  fee?: string;
  /** 账单类型 */
  billType?: 'TRADE' | 'REFUND';
  /** 退款单号（退款账单行） */
  refundNo?: string;
  raw?: Record<string, string>;
}

/** 渠道回调解析结果 */
export interface ParsedNotify {
  /** 支付中心订单号 */
  payOrderNo: string;
  /** 渠道交易号 */
  tradeNo: string;
  /** 归一化状态 */
  status: 'SUCCESS' | 'CLOSED' | 'REVOKED' | 'PAYING' | 'FAILED' | 'REFUND' | 'REFUNDED';
  amount?: string;
  paidAt?: Date;
  payerId?: string;
  /** 退款场景：渠道退款单号 */
  refundNo?: string;
  refundStatus?: 'SUCCESS' | 'FAILED' | 'PROCESSING' | 'CLOSED';
  refundAmount?: string;
  raw?: any;
}

export interface DownloadBillParams {
  /** 账单日期 YYYY-MM-DD */
  billDate: string;
  billType?: 'TRADE' | 'REFUND' | 'ALL';
}

/** 渠道适配器接口：新增渠道只需实现本接口并注册，业务代码零改动 */
export interface ChannelAdapter {
  readonly channel: string;
  /** 配置标识（商户号），便于日志排查 */
  readonly mchId: string;
  readonly isSandbox: boolean;

  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  queryPayment(params: { payOrderNo: string; channelTxnId?: string }): Promise<QueryPaymentResult>;
  closePayment(params: { payOrderNo: string }): Promise<void>;
  refund(params: RefundParams): Promise<RefundResult>;
  queryRefund(params: { refundNo: string; channelRefundId?: string; payOrderNo?: string }): Promise<QueryRefundResult>;
  downloadBill(params: DownloadBillParams): Promise<BillRow[]>;
  /** 验签并解析渠道回调（headers + rawBody） */
  parseNotify(params: {
    headers: Record<string, any>;
    rawBody: string;
    query?: Record<string, any>;
  }): Promise<ParsedNotify>;
  /** 响应给渠道的字符串（成功/失败），不同渠道格式不同 */
  notifyResponse(success: boolean, message?: string): { body: string; contentType?: string };
}
