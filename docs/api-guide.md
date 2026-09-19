# 统一支付中心 · 业务系统接入指南

> 版本 1.0 · 面向各业务项目的后端开发人员
> 全部接口为 JSON over HTTPS，约 30 分钟可完成接入。

## 1. 接入流程

1. 管理员在后台「业务系统」页为你的项目创建应用，获得 **AppId + AppSecret**（Secret 仅显示一次）。
2. 在应用配置里填写你的 **异步通知地址**（必须是 HTTPS）。
3. 按本文档实现签名与两个通知处理接口。
4. sandbox 联调：渠道使用 mock 模拟收银台，不出真实资金；切生产只需管理员改渠道配置，**你的代码零改动**。

## 2. 鉴权与签名

所有开放接口请求头：

| Header | 说明 |
| --- | --- |
| X-App-Id | 分配的 AppId |
| X-Timestamp | 秒级时间戳，与服务端偏差 ≤ 300s |
| X-Nonce | 32 位以内随机串，5 分钟内不可重复（防重放） |
| X-Sign | 签名 |

签名算法（method 与 path 参与签名，防止请求被重放到其它接口）：

```
待签串 = [ appId, timestamp, nonce, METHOD(大写), path, sha256Hex(原始请求体) ].join('\n')
sign   = HexLower( HMAC_SHA256( key = AppSecret, msg = 待签串 ) )
```

示例（Node.js）：

```js
const crypto = require('crypto');

/** @param path 请求路径，如 /api/v1/open/pay/create */
function signRequest(appId, appSecret, method, path, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const content = [appId, timestamp, nonce, method.toUpperCase(), path, bodyHash].join('\n');
  const sign = crypto.createHmac('sha256', appSecret).update(content).digest('hex').toLowerCase();
  return { 'X-App-Id': appId, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Sign': sign };
}

// 调用：body 必须是「最终发送出去的原始字符串」
const body = JSON.stringify({ appId, merchantOrderNo, amount: '12.34', /* ... */ });
const headers = signRequest(appId, appSecret, 'POST', '/api/v1/open/pay/create', body);
```

要点：
- 参与签名的是**未经任何修改的原始请求体字符串**，不要先 parse 再 stringify。
- `path` 必须与实际请求路径完全一致（含 `/api/v1/open/...` 前缀）。
- 服务端按同样方式验签，失败返回 `2004 签名错误`、`1006 请求已过期`、`2006 Nonce 重放`、`2007 IP 不在白名单`。

### 金额规范

金额单位为**元**，字符串，最多两位小数：`"12.34"`。禁止使用浮点数运算。

## 3. 统一下单

```
POST /api/v1/open/pay/create
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| merchantOrderNo | 是 | 业务订单号，幂等键（重复请求返回已有订单，不重复创建） |
| appId | 是 | 业务系统 AppId（与请求头一致） |
| amount | 是 | 支付金额（元，字符串） |
| subject | 是 | 商品标题（展示在收银台） |
| description | 否 | 商品描述 |
| channel | 否 | 指定渠道 wechat/alipay；不传由支付中心分配 |
| tradeType | 否 | JSAPI / NATIVE / APP / MINI / PAGE，默认按渠道取默认值 |
| openId | 否 | JSAPI/小程序支付必填 |
| returnUrl | 否 | 支付完成后前端跳转地址 |
| notifyUrl | 否 | 覆盖应用默认通知地址 |
| clientIp | 否 | 用户 IP |
| extra | 否 | 透传 JSON，通知时原样返回 |

成功响应（code=0）：

```json
{
  "code": 0,
  "data": {
    "payOrderNo": "P20260919...",
    "status": "CREATED",
    "payParams": { "payUrl": "..." }
  }
}
```

`payParams` 按渠道不同：
- wechat JSAPI/小程序：`{ prepayId, timeStamp, nonceStr, package, signType, paySign }`（直接喂给 `wx.requestPayment`）
- wechat NATIVE：`{ codeUrl }`（生成二维码）
- alipay PAGE：`{ payUrl }`（跳转或 form 提交）
- mock：`{ payUrl }`（模拟收银台地址）

**幂等**：同一 `merchantOrderNo + appId` 重复调用返回同一支付订单（含已支付订单）。

## 4. 查询 / 关单

```
POST /api/v1/open/pay/query   { payOrderNo? , merchantOrderNo? }  二选一
POST /api/v1/open/pay/close   { payOrderNo }
```

订单状态机：

```
CREATED → PAYING → SUCCESS → (REFUNDING → REFUNDED)
              ↘ CLOSED（超时/主动关单）
              ↘ REVOKED（用户取消）
              ↘ FAILED
```

## 5. 退款

```
POST /api/v1/open/refund/create
{
  "payOrderNo": "P2026...",        // 与 merchantOrderNo 二选一
  "merchantRefundNo": "R2026...",  // 业务退款单号，幂等键
  "amount": "5.00",                // 部分退款金额，不传=全额退款
  "reason": "用户申请退款",
  "notifyUrl": "https://..."       // 可选，覆盖默认
}

POST /api/v1/open/refund/query   { refundNo } 或 { merchantRefundNo }
```

退款单状态：`CREATED → PROCESSING → SUCCESS / FAILED / ABNORMAL / CLOSED`

规则：
- 累计退款金额不得超过支付金额（剩余可退金额会在错误信息中给出）。
- 一笔支付单可多次部分退款。
- FAILED 状态的退款可在后台人工重试。

## 6. 异步通知（支付中心 → 业务系统）

支付成功、退款完成时，支付中心 POST JSON 到配置的通知地址：

```json
{
  "bizType": "PAYMENT_SUCCESS",        // 或 REFUND_SUCCESS / REFUND_FAILED
  "payOrderNo": "P2026...",
  "merchantOrderNo": "B2026...",
  "appId": "app_xxx",
  "amount": "12.34",
  "paidAmount": "12.34",
  "channel": "wechat",
  "channelTxnId": "42000...",
  "refundNo": "R2026...",              // 仅退款通知
  "refundAmount": "5.00",
  "status": "SUCCESS",
  "paidAt": "2026-09-19 12:00:00",
  "extra": { ... },                    // 下单透传参数
  "timestamp": 1726728000,
  "nonce": "a1b2c3"
}
```

**验签**（必须实现）：签名放在通知头 `X-Pay-Sign`，待签串为

```
待签串 = [ appId, X-Pay-Timestamp, X-Pay-Nonce, sha256Hex(原始通知体) ].join('\n')
sign   = HexLower( HMAC_SHA256( key = AppSecret, msg = 待签串 ) )
```

```js
const crypto = require('crypto');

function verifyNotify(appSecret, headers, rawBody) {
  const content = [headers['x-pay-app-id'], headers['x-pay-timestamp'], headers['x-pay-nonce'],
    crypto.createHash('sha256').update(rawBody).digest('hex')].join('\n');
  const expected = crypto.createHmac('sha256', appSecret).update(content).digest('hex').toLowerCase();
  return expected === String(headers['x-pay-sign'] || '').toLowerCase();
}
```

**应答**：处理成功返回任意 2xx 且 body 为 `{"code":"SUCCESS"}`；否则视为失败进入重试。

**重试策略**：`15s / 30s / 1m / 2m / 5m / 10m / 30m / 1h / 2h / 6h / 12h`，共 11 次；仍失败进入死信，后台可见并可人工重投。请保证通知处理的**幂等**（以 payOrderNo 去重）。

## 7. 错误码

| code | 含义 |
| --- | --- |
| 0 | 成功 |
| 1001 | 参数错误 |
| 1002 | 系统繁忙（可重试） |
| 1003 | 数据不存在 / 接口不存在 |
| 1004 | 操作过于频繁（限流） |
| 1005 | 禁止访问 |
| 1006 | 请求已过期（时间戳超出 5 分钟窗口） |
| 2001/2002 | AppId 不存在 / 已停用 |
| 2003/2004 | 缺少签名参数 / 签名校验失败 |
| 2005/2006 | 时间戳不合法 / Nonce 重放 |
| 2007/2008 | IP 不在白名单 / 未开通此支付渠道 |
| 3001~3009 | 订单不存在 / 状态不允许 / 已支付 / 已关闭 / 已过期 / 金额不合法 / 金额超限 / 幂等冲突 / 关单失败 |
| 4001~4007 | 退款单不存在 / 金额不合法 / 超出可退 / 原单未支付 / 状态不允许 / 渠道退款失败 / 幂等冲突 |
| 5001~5006 | 渠道配置不存在 / 已停用 / 配置不完整 / 请求失败 / 返回报文异常 / 渠道侧订单不存在 |
| 6001~6006 | 对账执行中 / 批次不存在 / 未找到账单 / 账单解析失败 / 差异不存在 / 差异已处理 |

响应统一结构：`{ code, message, data, traceId, timestamp }`，`code !== 0` 即失败；排查问题时请提供 `traceId`。

## 8. 联调自查清单

- [ ] 签名使用原始请求体，时间戳取秒
- [ ] nonce 生成器保证 5 分钟内不重复
- [ ] 收到通知先验签，处理后幂等落库
- [ ] 未收到通知时可用 query 接口兜底轮询（建议支付后 5s/30s/5m 三次）
- [ ] 金额全部按字符串处理，禁止浮点
