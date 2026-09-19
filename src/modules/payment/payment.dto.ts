import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';
import { Channel, TradeType } from '../../common/constants/enums';
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

  @IsOptional()
  @IsIn(AVAILABLE_CHANNELS)
  channel?: string = Channel.WECHAT;

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
