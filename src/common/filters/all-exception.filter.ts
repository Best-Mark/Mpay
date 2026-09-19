import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BizException } from '../exceptions/biz.exception';
import { ErrorCode, ErrorMessage } from '../constants/error-codes';
import { TraceContext } from '../utils/trace-context';

/**
 * 全局异常过滤器
 * 无论业务异常还是系统异常，对业务系统一律返回标准 JSON：
 * { code, message, data:null, traceId, timestamp }
 * 系统异常不暴露堆栈，只回传 traceId 便于排查
 */
@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const traceId = TraceContext.getTraceId() || '-';

    let code: number = ErrorCode.SYSTEM_ERROR;
    let message = ErrorMessage[ErrorCode.SYSTEM_ERROR];
    let httpStatus = HttpStatus.OK;
    let logLevel: 'error' | 'warn' = 'error';

    if (exception instanceof BizException) {
      code = exception.code;
      message = exception.detail || ErrorMessage[code] || exception.message;
      httpStatus = exception.httpStatus;
      logLevel = 'warn';
    } else if (exception?.status && exception?.response) {
      // NestJS 内置 HttpException（如 404、校验失败）
      httpStatus = exception.status;
      const resp = exception.response;
      if (httpStatus === HttpStatus.NOT_FOUND) {
        code = ErrorCode.DATA_NOT_FOUND;
        message = '接口不存在';
      } else if (httpStatus === HttpStatus.TOO_MANY_REQUESTS) {
        code = ErrorCode.OPERATION_TOO_FREQUENT;
        message = '请求过于频繁';
      } else {
        code = ErrorCode.PARAM_ERROR;
        message = typeof resp === 'string' ? resp : resp?.message || '参数错误';
      }
      logLevel = 'warn';
    }

    const body = {
      code,
      message,
      data: null,
      traceId,
      timestamp: Date.now(),
    };

    const logMsg = `[${traceId}] ${req.method} ${req.originalUrl} -> code=${code} ${message}`;
    if (logLevel === 'error') {
      this.logger.error(logMsg, exception?.stack);
    } else {
      this.logger.warn(logMsg);
    }

    if (res.headersSent) return;
    res.status(httpStatus).json(body);
  }
}
