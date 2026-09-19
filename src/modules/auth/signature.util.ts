import { CryptoUtil } from '../../common/utils/crypto.util';

export const SIGN_HEADER = {
  appId: 'x-app-id',
  timestamp: 'x-timestamp',
  nonce: 'x-nonce',
  sign: 'x-sign',
} as const;

/** 回调通知签名头（支付中心 -> 业务系统） */
export const NOTIFY_SIGN_HEADER = {
  appId: 'x-pay-app-id',
  timestamp: 'x-pay-timestamp',
  nonce: 'x-pay-nonce',
  sign: 'x-pay-sign',
  traceId: 'x-pay-trace-id',
} as const;

/**
 * 待签串构造：appId \n timestamp \n nonce \n METHOD \n path \n sha256(body)
 * 把 method 与 path 纳入签名，防止请求被重定向到其它接口重放
 */
export function buildSignString(params: {
  appId: string;
  timestamp: string;
  nonce: string;
  method?: string;
  path?: string;
  body?: string | object;
}): string {
  const bodyStr =
    typeof params.body === 'string'
      ? params.body
      : params.body === undefined || params.body === null
        ? ''
        : JSON.stringify(params.body);
  const bodyHash = CryptoUtil.sha256(bodyStr);
  return [
    params.appId,
    params.timestamp,
    params.nonce,
    (params.method || 'POST').toUpperCase(),
    params.path || '',
    bodyHash,
  ].join('\n');
}

/** 计算签名（小写 hex） */
export function sign(params: {
  appId: string;
  timestamp: string;
  nonce: string;
  method?: string;
  path?: string;
  body?: string | object;
  secret: string;
}): string {
  const content = buildSignString(params);
  return CryptoUtil.hmacSha256(content, params.secret).toLowerCase();
}

/** 校验签名 */
export function verifySign(params: {
  appId: string;
  timestamp: string;
  nonce: string;
  method?: string;
  path?: string;
  body?: string | object;
  secret: string;
  provided: string;
}): boolean {
  const expected = sign(params);
  return CryptoUtil.safeEqual(expected, (params.provided || '').toLowerCase());
}

/** 回调通知签名（支付中心推送给业务系统时使用） */
export function signNotify(params: {
  appId: string;
  body: object;
  secret: string;
}): { timestamp: string; nonce: string; sign: string } {
  const timestamp = String(Date.now());
  const nonce = CryptoUtil.randomString(16);
  const content = [params.appId, timestamp, nonce, CryptoUtil.sha256(JSON.stringify(params.body))].join('\n');
  return { timestamp, nonce, sign: CryptoUtil.hmacSha256(content, params.secret).toLowerCase() };
}

/** 回调通知验签（业务系统侧校验支付中心推送） */
export function verifyNotifySign(params: {
  appId: string;
  timestamp: string;
  nonce: string;
  body: object;
  secret: string;
  provided: string;
}): boolean {
  const content = [
    params.appId,
    params.timestamp,
    params.nonce,
    CryptoUtil.sha256(JSON.stringify(params.body)),
  ].join('\n');
  const expected = CryptoUtil.hmacSha256(content, params.secret).toLowerCase();
  return CryptoUtil.safeEqual(expected, (params.provided || '').toLowerCase());
}
