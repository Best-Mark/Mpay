/**
 * 统一支付中心 · Node.js 接入 SDK（零依赖，可直接拷贝进业务项目）
 *
 * 使用：
 *   const client = createPayClient({ baseUrl: 'https://pay.xxx.com', appId, appSecret });
 *   const order = await client.createOrder({ merchantOrderNo, amount: '12.34', subject, channel: 'wechat', tradeType: 'JSAPI' });
 *   const detail = await client.queryOrder({ payOrderNo: order.payOrderNo });
 *
 * 约定：
 *   - 金额一律字符串（元，两位小数），禁止浮点运算
 *   - 所有写接口带幂等键（merchantOrderNo / merchantRefundNo），重试安全
 *   - code !== 0 会抛出 Error（带 code / traceId）
 */
const crypto = require('crypto');

const PATHS = {
  create: '/api/v1/open/pay/create',
  query: '/api/v1/open/pay/query',
  close: '/api/v1/open/pay/close',
  channels: '/api/v1/open/pay/channels',
  refund: '/api/v1/open/refund/create',
  refundQuery: '/api/v1/open/refund/query',
};

/** 渠道自动路由：不传 channel 时由支付中心按商户已开通渠道 + 场景自动选择，新增渠道无需升级 SDK */
const CHANNEL_AUTO = 'auto';

/** 待签串：appId \n timestamp \n nonce \n METHOD \n path \n sha256(body) */
function buildSignString({ appId, timestamp, nonce, method, path, body }) {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  return [appId, timestamp, nonce, method.toUpperCase(), path, bodyHash].join('\n');
}

function sign({ appId, appSecret, method, path, body }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const content = buildSignString({ appId, timestamp, nonce, method, path, body });
  const signature = crypto.createHmac('sha256', appSecret).update(content).digest('hex').toLowerCase();
  return {
    'X-App-Id': appId,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Sign': signature,
  };
}

/** 校验支付中心推送过来的通知签名（务必在业务处理后落库前校验） */
function verifyNotify({ appSecret, headers, rawBody }) {
  const content = [
    headers['x-pay-app-id'] || '',
    headers['x-pay-timestamp'] || '',
    headers['x-pay-nonce'] || '',
    crypto.createHash('sha256').update(rawBody).digest('hex'),
  ].join('\n');
  const expected = crypto.createHmac('sha256', appSecret).update(content).digest('hex').toLowerCase();
  return expected === String(headers['x-pay-sign'] || '').toLowerCase();
}

function createPayClient({ baseUrl, appId, appSecret, timeoutMs = 10000 }) {
  async function request(path, payload) {
    const body = JSON.stringify(payload || {});
    const res = await fetch(baseUrl.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sign({ appId, appSecret, method: 'POST', path, body }),
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({ code: 1002, message: '响应解析失败' }));
    if (json.code !== 0) {
      const err = new Error(`[${json.code}] ${json.message || '支付中心返回失败'}`);
      err.code = json.code;
      err.traceId = json.traceId;
      throw err;
    }
    return json.data;
  }

  return {
    /** 下单（幂等：同一 merchantOrderNo 返回同一订单）；channel 默认 auto，由服务端路由 */
    createOrder: (params) => request(PATHS.create, { appId, channel: CHANNEL_AUTO, ...params }),
    /** 查询当前应用可用渠道：[{ channel, label, scenes }]，新增渠道会自动出现 */
    listChannels: () => request(PATHS.channels, { appId }),
    /** 查单：{ payOrderNo } 或 { merchantOrderNo } */
    queryOrder: (params) => request(PATHS.query, { appId, ...params }),
    /** 关闭未支付订单 */
    closeOrder: (payOrderNo) => request(PATHS.close, { appId, payOrderNo }),
    /** 退款（幂等键 merchantRefundNo） */
    refund: (params) => request(PATHS.refund, { appId, ...params }),
    /** 查退款：{ refundNo } 或 { merchantRefundNo } */
    queryRefund: (params) => request(PATHS.refundQuery, { appId, ...params }),
    /** 通知验签（传入原始 body 字符串，不要 parse 后再 stringify） */
    verifyNotify: ({ headers, rawBody }) => verifyNotify({ appSecret, headers, rawBody }),
  };
}

module.exports = { createPayClient, sign, verifyNotify, buildSignString, PATHS };
