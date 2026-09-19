import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PortalService } from './portal.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

/** 商户登录态守卫（与后台管理员 JWT 隔离：payload.type 必须为 MERCHANT） */
@Injectable()
export class MerchantAuthGuard implements CanActivate {
  constructor(private readonly portal: PortalService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'] as string;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new BizException(ErrorCode.TOKEN_INVALID, '请先登录', 401);

    const principal = this.portal.verifyToken(token);
    if (!principal) throw new BizException(ErrorCode.TOKEN_EXPIRED, '登录态无效或已过期', 401);
    (req as any).merchant = principal;
    return true;
  }
}

/** 取当前登录商户 */
export function currentMerchant(req: any) {
  return req.merchant as { sub: string; email: string; companyName: string };
}
