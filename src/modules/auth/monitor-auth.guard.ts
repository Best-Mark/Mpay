import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MerchantService } from '../merchant/merchant.service';
import { RedisService } from '../../common/redis/redis.service';
import { ApiSignGuard } from './api-sign.guard';
import { SIGN_HEADER } from './signature.util';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { TraceContext } from '../../common/utils/trace-context';

/**
 * 监控器上报专用鉴权：签名优先，固定 Token 兜底
 *
 * 为什么要多一种认证方式：
 *  「到账通知转发」这类零开发方案（Tasker / MacroDroid / 短信转发器等）只能发一个
 *  带固定 Header 或 URL 参数的 HTTP 请求，算不出 HMAC 签名（需要时间戳 + nonce + 摘要）。
 *  所以给每个业务系统额外发一枚长期 Token，专供上报接口使用。
 *
 * 安全边界（必须清楚，Token ≠ AppSecret）：
 *  - Token 只能调用「到账上报」三个接口，不能下单 / 查单 / 退款
 *  - 上报只能匹配到该业务系统自己「待支付」的订单，且金额必须对上，
 *    所以 Token 泄露的最坏后果是商户自己把自己的订单点成已付 —— 不会跨商户、不会动别人的钱
 *  - Token 可在后台随时重置（重置即失效）
 */
@Injectable()
export class MonitorAuthGuard implements CanActivate {
  private readonly logger = new Logger(MonitorAuthGuard.name);
  private readonly signGuard: ApiSignGuard;

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantService: MerchantService,
    redis: RedisService,
  ) {
    this.signGuard = new ApiSignGuard(merchantService, redis);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // 1) 带完整签名头 → 走标准开放接口鉴权（业务系统自己集成时用）
    const hasSign =
      !!req.headers[SIGN_HEADER.appId] &&
      !!req.headers[SIGN_HEADER.timestamp] &&
      !!req.headers[SIGN_HEADER.nonce] &&
      !!req.headers[SIGN_HEADER.sign];
    if (hasSign) return this.signGuard.canActivate(context);

    // 2) 固定 Token（Header 或 URL 参数，后者给只能配 URL 的转发工具用）
    const token = ((req.headers['x-monitor-token'] as string) || (req.query?.token as string) || '').trim();
    if (!token) {
      throw new BizException(
        ErrorCode.SIGN_MISSING,
        '缺少鉴权：请带 X-App-Id/X-Timestamp/X-Nonce/X-Sign 签名头，或带 X-Monitor-Token（也支持 ?token=）',
      );
    }

    const app = await this.prisma.merchantApp.findFirst({
      where: { monitorToken: token, enabled: true },
    });
    if (!app) {
      this.logger.warn(`monitor token 无效 ip=${req.ip} path=${req.path}`);
      throw new BizException(ErrorCode.SIGN_INVALID, 'monitor token 无效或业务系统已停用');
    }

    TraceContext.set({ appId: app.appId });
    (req as any).merchantApp = app;
    (req as any).authBy = 'monitor-token';
    return true;
  }
}
