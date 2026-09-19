import { IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateRefundDto {
  /** 原支付中心订单号，二选一 */
  @IsOptional()
  @IsString()
  payOrderNo?: string;

  /** 原业务订单号，二选一 */
  @IsOptional()
  @IsString()
  merchantOrderNo?: string;

  /** 业务系统退款单号（同一 AppId 下唯一，幂等键） */
  @IsNotEmpty({ message: 'merchantRefundNo 必填' })
  @IsString()
  @MaxLength(64)
  merchantRefundNo: string;

  /** 退款金额（元），不传则默认全额退款 */
  @IsOptional()
  @IsPositive()
  amount?: number;

  /** 退款原因 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reason?: string;

  @IsOptional()
  @IsString()
  notifyUrl?: string;

  @IsOptional()
  extra?: Record<string, any>;
}

export class QueryRefundDto {
  @IsOptional()
  @IsString()
  refundNo?: string;

  @IsOptional()
  @IsString()
  merchantRefundNo?: string;

  /** 是否强制向渠道查询 */
  @IsOptional()
  force?: boolean;
}
