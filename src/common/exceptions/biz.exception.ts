import { ErrorCode, ErrorMessage } from '../constants/error-codes';

/**
 * 业务异常：统一携带错误码，由全局过滤器转成标准响应
 * 用法：throw new BizException(ErrorCode.ORDER_NOT_FOUND)
 */
export class BizException extends Error {
  public readonly code: number;
  public readonly httpStatus: number;
  public readonly detail?: string;

  constructor(code: number, detail?: string, httpStatus = 200) {
    super(detail || ErrorMessage[code] || '业务异常');
    this.code = code;
    this.detail = detail;
    this.httpStatus = httpStatus;
    this.name = 'BizException';
  }

  static paramError(detail?: string): BizException {
    return new BizException(ErrorCode.PARAM_ERROR, detail);
  }

  static notFound(detail?: string): BizException {
    return new BizException(ErrorCode.DATA_NOT_FOUND, detail);
  }
}

/** 断言：条件不成立时抛业务异常 */
export function assert(condition: any, code: number, detail?: string): asserts condition {
  if (!condition) throw new BizException(code, detail);
}

/** 断言参数 */
export function assertParam(condition: any, detail?: string): asserts condition {
  if (!condition) throw new BizException(ErrorCode.PARAM_ERROR, detail);
}
