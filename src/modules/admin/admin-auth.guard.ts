import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService, AdminPrincipal } from './admin-auth.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { AdminRole } from '../../common/constants/enums';
import { TraceContext } from '../../common/utils/trace-context';

/**
 * 管理后台 JWT 守卫
 * 用法：@UseGuards(AdminAuthGuard)，如需限制角色配合 @Roles(AdminRole.SUPER)
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'] as string;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new BizException(ErrorCode.TOKEN_INVALID, '缺少登录态', 401);

    const principal = this.auth.verifyToken(token);
    if (!principal) throw new BizException(ErrorCode.TOKEN_EXPIRED, '登录态无效或已过期', 401);

    // 角色校验（@Roles 装饰器设置的元数据）
    const roles = Reflect.getMetadata('admin:roles', context.getHandler()) as AdminRole[] | undefined;
    if (roles?.length && !roles.includes(principal.role as AdminRole)) {
      throw new BizException(ErrorCode.PERMISSION_DENIED, '权限不足', 403);
    }

    TraceContext.set({ operator: principal.username });
    (req as any).admin = principal;
    return true;
  }
}

/** 角色限制装饰器 */
export function Roles(...roles: AdminRole[]): MethodDecorator {
  return (target: any, key: string | symbol, descriptor: any) => {
    Reflect.defineMetadata('admin:roles', roles, descriptor.value);
    return descriptor;
  };
}

/** 取当前登录管理员 */
export function currentAdmin(req: any): AdminPrincipal {
  return req.admin as AdminPrincipal;
}
