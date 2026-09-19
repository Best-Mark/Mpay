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

/**
 * 前端唤起支付的「形态」（支付中心统一契约）
 *
 * 这是 SDK 一次接入的关键：渠道千差万别，但落到前端只有这几种形态。
 * 新渠道只要产出其中一种（或在适配器里直接返回 payInfo），老 SDK 无需升级即可渲染。
 */
export type PayInfoType =
  /** 展示二维码让用户扫（NATIVE） */
  | 'qrcode'
  /** 网页内唤起支付（微信 JSAPI 等） */
  | 'jsapi'
  /** 唤起 App 支付（微信 / 支付宝 / 云闪付 App） */
  | 'app'
  /** 跳转到渠道收银台链接（PC / H5） */
  | 'redirect'
  /** 自动提交表单到网关（网银 / 银联前台交易） */
  | 'form'
  /** 无需前端动作：条码付、模拟渠道等，等待回调即可 */
  | 'none';

/** 统一的支付唤起信息（与渠道无关） */
export interface PayInfo {
  type: PayInfoType;
  /** type=qrcode：二维码内容（生成二维码展示） */
  codeUrl?: string;
  /** type=jsapi / app：唤起支付参数（微信 JSAPI 六参、支付宝 orderInfo、银联 tn…） */
  params?: Record<string, any>;
  /** type=redirect：跳转地址 */
  url?: string;
  /** type=form：表单提交地址与方法、字段 */
  action?: string;
  method?: 'GET' | 'POST';
  fields?: Record<string, string>;
  /** 渠道原始 payParams：出现未知形态时业务侧可自行兜底 */
  raw?: any;
}

/**
 * 把渠道各异的 payParams 归一成统一 PayInfo
 * 历史订单同样适用（读库时实时归一化），无需数据迁移。
 */
export function normalizePayInfo(tradeType: string, payParams?: Record<string, any> | null, preferred?: PayInfo): PayInfo {
  if (preferred) return { ...preferred, raw: preferred.raw ?? payParams ?? undefined };
  const p = (payParams || {}) as Record<string, any>;
  const { tradeType: _ignored, ...rest } = p;

  // 被扫付：渠道侧已直接扣款，前端无需动作，等回调
  if (tradeType === TradeType.FACE_TO_FACE) return { type: 'none', raw: p };

  // 表单自动提交（网银 / 银联前台交易）
  if (p.fields && (p.action || p.payUrl)) {
    return { type: 'form', action: p.action || p.payUrl, method: p.method || 'POST', fields: p.fields, raw: p };
  }
  // 二维码
  if (p.codeUrl || p.qrCode) return { type: 'qrcode', codeUrl: p.codeUrl || p.qrCode, raw: p };
  // 网页内唤起
  if (tradeType === TradeType.JSAPI) return { type: 'jsapi', params: rest, raw: p };
  // App 唤起
  if (tradeType === TradeType.APP) return { type: 'app', params: rest, raw: p };
  // 跳转收银台（含模拟渠道的收银台地址）
  const url = p.payUrl || p.h5Url || p.mockPayUrl || p.url;
  if (url) return { type: 'redirect', url, raw: p };
  // 只有 formHtml 的历史数据：给出 action，业务侧可直接输出 html
  if (p.formHtml) return { type: 'form', action: p.payUrl, method: 'POST', raw: p };

  return { type: 'none', raw: p };
}

/** 下单结果：payParams 直接返回给业务系统用于唤起支付 */
export interface CreatePaymentResult {
  /** 渠道交易号（微信 prepay_id 时可能无，用 channelTxnId 表示已生成的渠道单号） */
  channelTxnId?: string;
  /** 唤起支付所需的参数集合，原样返回业务系统 */
  payParams: Record<string, any>;
  /**
   * 统一形态的唤起信息（可选）。
   * 新渠道适配器建议直接给出；未提供时支付中心会按 payParams + tradeType 自动归一化。
   */
  payInfo?: PayInfo;
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
