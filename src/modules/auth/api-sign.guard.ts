import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { MerchantService } from '../merchant/merchant.service';
import { RedisService } from '../../common/redis/redis.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { SIGN_HEADER, verifySign } from './signature.util';
import { TraceContext } from '../../common/utils/trace-context';

/** 时间戳有效窗口：5 分钟 */
const TIME_WINDOW_MS = 5 * 60 * 1000;
/** nonce 存活时间：10 分钟（大于时间窗，确保窗口内可判重） */
const NONCE_TTL_SECONDS = 600;

/**
 * 开放接口签名守卫（AppKey + 签名 + 防重放）
 * 挂在 /api/v1/open/** 上
 */
@Injectable()
export class ApiSignGuard implements CanActivate {
  private readonly logger = new Logger(ApiSignGuard.name);

  constructor(
    private readonly merchantService: MerchantService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: string }>();
    const appId = (req.headers[SIGN_HEADER.appId] as string) || '';
    const timestamp = (req.headers[SIGN_HEADER.timestamp] as string) || '';
    const nonce = (req.headers[SIGN_HEADER.nonce] as string) || '';
    const provided = (req.headers[SIGN_HEADER.sign] as string) || '';

    if (!appId || !timestamp || !nonce || !provided) {
      throw new BizException(ErrorCode.SIGN_MISSING, '缺少 X-App-Id / X-Timestamp / X-Nonce / X-Sign 请求头');
    }

    // 1. 时间戳窗口（防重放 + 防时钟漂移）
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) throw new BizException(ErrorCode.TIMESTAMP_INVALID);
    if (Math.abs(Date.now() - ts) > TIME_WINDOW_MS) {
      throw new BizException(ErrorCode.REQUEST_EXPIRED, '请求时间戳超出 5 分钟有效窗口');
    }

    // 2. AppId 有效性与密钥
    const app = await this.merchantService.getSecret(appId);

    // 3. IP 白名单
    const clientIp = this.getClientIp(req);
    this.merchantService.assertIpAllowed(app, clientIp);

    // 4. 签名校验
    const rawBody = req.rawBody ?? (req.body ? JSON.stringify(req.body) : '');
    const ok = verifySign({
      appId,
      timestamp,
      nonce,
      method: req.method,
      path: req.path,
      body: rawBody,
      secret: app.appSecret,
      provided,
    });
    if (!ok) {
      this.logger.warn(`签名失败 appId=${appId} ip=${clientIp} path=${req.path}`);
      throw new BizException(ErrorCode.SIGN_INVALID);
    }

    // 5. nonce 判重（防重放）
    const nonceKey = `nonce:${appId}:${nonce}`;
    const fresh = await this.redis.setNx(nonceKey, '1', NONCE_TTL_SECONDS);
    if (!fresh) throw new BizException(ErrorCode.NONCE_REPLAY, 'nonce 已被使用');

    // 注入上下文
    TraceContext.set({ appId });
    (req as any).merchantApp = app;
    (req as any).clientIp = clientIp;
    return true;
  }

  private getClientIp(req: Request): string {
    const xf = req.headers['x-forwarded-for'] as string;
    if (xf) return xf.split(',')[0].trim();
    return (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  }
}
