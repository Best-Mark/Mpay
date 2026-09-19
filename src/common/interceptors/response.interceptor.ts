import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { TraceContext } from '../utils/trace-context';

/**
 * 统一成功响应包装：
 * { code: 0, message: 'success', data, traceId, timestamp }
 * 若 controller 已返回 { code, ... } 结构则原样透传（避免二次包装）
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        Object.prototype.hasOwnProperty.call(data, 'code')
      ) {
        return { ...data, traceId: TraceContext.getTraceId() };
      }
      return {
        code: 0,
        message: 'success',
        data: data === undefined ? null : data,
        traceId: TraceContext.getTraceId(),
        timestamp: Date.now(),
      };
      }),
    );
  }
}
