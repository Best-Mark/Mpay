import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';
import { Channel, CHANNEL_AUTO, TradeType } from '../../common/constants/enums';
import { AVAILABLE_CHANNELS } from '../channel/channel-meta';

export class CreateOrderDto {
  /** 业务系统订单号（同一 AppId 下唯一，幂等键） */
  @IsNotEmpty({ message: 'merchantOrderNo 必填' })
  @IsString()
  @MaxLength(64)
  merchantOrderNo: string;

  /** 订单金额（元），最多 2 位小数 */
  @IsPositive({ message: 'amount 必须为正数' })
  amount: number;

  /**
   * 支付渠道：不传或传 'auto' 时由支付中心按「应用已开通渠道 + 场景 + 优先级」自动路由。
   * 建议业务系统不要写死具体渠道 —— 这样平台新增渠道时无需升级 SDK / 改代码。
   */
  @IsOptional()
  @IsIn([...AVAILABLE_CHANNELS, CHANNEL_AUTO])
  channel?: string = CHANNEL_AUTO;

  @IsOptional()
  @IsIn(Object.values(TradeType))
  tradeType?: string = TradeType.JSAPI;

  @IsNotEmpty({ message: 'subject 必填' })
  @IsString()
  @MaxLength(128)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  body?: string;

  /** 附加数据，回调原样返回 */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  attach?: string;

  @IsOptional()
  @IsString()
  clientIp?: string;

  /** 付款者标识：微信 JSAPI 需传 openid */
  @IsOptional()
  @IsString()
  payerId?: string;

  /** 订单有效期（分钟），默认 30，范围 1~1440 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  expireMinutes?: number = 30;

  /** 覆盖默认的支付结果通知地址（需在业务系统配置范围内） */
  @IsOptional()
  @IsString()
  notifyUrl?: string;

  @IsOptional()
  extra?: Record<string, any>;
}

export class QueryOrderDto {
  /** 支付中心订单号，二选一 */
  @IsOptional()
  @IsString()
  payOrderNo?: string;

  /** 业务订单号，二选一 */
  @IsOptional()
  @IsString()
  merchantOrderNo?: string;

  /** 是否强制向渠道发起查询（忽略本地终态缓存） */
  @IsOptional()
  force?: boolean;
}

export class CloseOrderDto {
  @IsOptional()
  @IsString()
  payOrderNo?: string;

  @IsOptional()
  @IsString()
  merchantOrderNo?: string;
}

/**
 * 商户自助确认到账（仅个人收款码渠道）
 * 有官方回调的渠道（微信/支付宝/银联）禁止人工置成功 —— 否则等于绕过渠道真实状态，
 * 可以把「渠道根本没收到钱」的订单标记成已支付。
 */
export class ConfirmPaidDto {
  /** 支付中心订单号，二选一 */
  @IsOptional()
  @IsString()
  payOrderNo?: string;

  /** 业务订单号，二选一 */
  @IsOptional()
  @IsString()
  merchantOrderNo?: string;

  /** 实际到账金额（元）：必填，必须与订单应付金额一致，否则需显式 allowDiff */
  @IsPositive({ message: 'paidAmount 必须为正数（实际到账金额）' })
  paidAmount: number;

  /** 账单里的渠道流水号 / 交易号（便于事后对账） */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  channelTxnId?: string;

  /** 付款方昵称 / 账号 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  payerAccount?: string;

  /** 到账时间（ISO），缺省为当前时间 */
  @IsOptional()
  @IsString()
  paidAt?: string;

  /** 允许实收金额与应付金额不一致（少付/多付）：默认 false，不一致直接拒绝 */
  @IsOptional()
  allowDiff?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  remark?: string;
}
