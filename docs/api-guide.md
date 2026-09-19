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

签名算法：

```
sign = Hex( HMAC_SHA256( key = AppSecret,
                         msg = appId + timestamp + nonce + 原始请求体JSON ) )
```

示例（Node.js）：

```js
const crypto = require('crypto');

function signRequest(appId, appSecret, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(12).toString('hex');
  const sign = crypto
    .createHmac('sha256', appSecret)
    .update(appId + timestamp + nonce + JSON.stringify(body))
    .digest('hex');
  return { 'X-App-Id': appId, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Sign': sign };
}
```

要点：
- 参与签名的是**未经任何修改的原始请求体字符串**，不要先 parse 再 stringify。
- 服务端按同样方式验签，失败返回 `40100 签名错误`、`40101 时间戳过期`、`40102 Nonce 重放`。

### 金额规范

金额单位为**元**，字符串，最多两位小数：`"12.34"`。禁止使用浮点数运算。

## 3. 统一下单

```
POST /api/v1/payment/create
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
POST /api/v1/payment/query   { payOrderNo? , merchantOrderNo? }  二选一
POST /api/v1/payment/close   { payOrderNo }
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
POST /api/v1/refund/create
{
  "payOrderNo": "P2026...",        // 与 merchantOrderNo 二选一
  "merchantRefundNo": "R2026...",  // 业务退款单号，幂等键
  "amount": "5.00",                // 部分退款金额，不传=全额退款
  "reason": "用户申请退款",
  "notifyUrl": "https://..."       // 可选，覆盖默认
}

POST /api/v1/refund/query   { refundNo } 或 { merchantRefundNo }
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

**验签**（必须实现）：

```
sign = Hex( HMAC_SHA256( key = AppSecret, msg = appId + bizType + payOrderNo + amount + timestamp + nonce ) )
```

**应答**：处理成功返回任意 2xx 且 body 为 `{"code":"SUCCESS"}`；否则视为失败进入重试。

**重试策略**：`15s / 30s / 1m / 2m / 5m / 10m / 30m / 1h / 2h / 6h / 12h`，共 11 次；仍失败进入死信，后台可见并可人工重投。请保证通知处理的**幂等**（以 payOrderNo 去重）。

## 7. 错误码

| code | 含义 |
| --- | --- |
| 0 | 成功 |
| 1001/1002/1003 | 参数错误 / JSON 解析失败 / 缺少必要字段 |
| 1004 | 请求过于频繁（限流） |
| 2001/2002/2003/2004 | AppId 不存在 / 已停用 / IP 不在白名单 / 无渠道权限 |
| 3001~3010 | 订单不存在 / 状态不符 / 重复支付 / 余额不足退款 / 金额超限 / 渠道下单失败 |
| 40100~40102 | 签名错误 / 时间戳过期 / Nonce 重放 |
| 5000/5001 | 系统异常 / 渠道异常（可重试） |

## 8. 联调自查清单

- [ ] 签名使用原始请求体，时间戳取秒
- [ ] nonce 生成器保证 5 分钟内不重复
- [ ] 收到通知先验签，处理后幂等落库
- [ ] 未收到通知时可用 query 接口兜底轮询（建议支付后 5s/30s/5m 三次）
- [ ] 金额全部按字符串处理，禁止浮点
