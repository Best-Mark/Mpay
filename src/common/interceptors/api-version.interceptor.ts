import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { OPEN_API_VERSION } from '../../modules/payment/openapi-contract';

/**
 * 开放接口版本协商：所有 v1 响应都带 X-Api-Version
 *
 * 业务系统 / SDK 可据此判断服务端契约版本；
 * 将来若有 v2，老 SDK 仍能靠该头确认自己走的 v1 依旧可用。
 */
@Injectable()
export class ApiVersionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(() => {
        try {
          const res = context.switchToHttp().getResponse();
          if (res && typeof res.setHeader === 'function' && !res.headersSent) {
            res.setHeader('X-Api-Version', String(OPEN_API_VERSION));
          }
        } catch {
          // 版本头属于锦上添花，失败不影响业务响应
        }
      }),
    );
  }
}
