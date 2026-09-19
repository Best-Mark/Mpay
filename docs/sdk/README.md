# 统一支付中心 · 多语言 SDK

全部 SDK **零第三方依赖**（只用各语言标准库 / 运行时自带能力），单文件即可使用，可直接拷贝进业务项目。

| 语言 | 文件 | 运行环境要求 | 依赖 |
| --- | --- | --- | --- |
| Node.js | `pay-sdk-node.js`（仓库 `docs/sdk-node.js`） | Node 18+（自带 fetch） | 无 |
| Java | `PayClient.java` | JDK 11+ | 无（HttpClient + 内置 JSON 读写） |
| PHP | `PayClient.php` | PHP 7.4+ | 仅 curl 扩展 |
| Python | `pay_client.py` | Python 3.8+ | 无（urllib） |
| Go | `payclient.go` | Go 1.18+ | 无（net/http） |

## 渠道无关：一次接入，新增渠道不必升级 SDK

SDK 里**没有任何渠道枚举、没有渠道白名单校验**。渠道决策全在服务端：

- 下单时**不传 `channel`**（或传 `auto`）→ 支付中心按「应用已开通渠道 ∩ 场景 ∩ 渠道优先级」自动路由
- 想要指定渠道就传具体值（如 `channel: 'alipay'`），但**不推荐写死**
- 平台新增渠道（京东支付、数字人民币……）时，服务端上线即可用，**SDK 与业务代码零改动**

需要展示收银台时，用渠道发现接口动态拉取，不要把渠道列表写死在前端/配置里：

```js
const { channels } = await client.listChannels();
// [{ channel: 'wechat', label: '微信支付', scenes: ['JSAPI','NATIVE',...] }, ...]
```

| 语言 | 方法 |
| --- | --- |
| Node.js | `client.listChannels()` |
| Java | `client.listChannels()` |
| PHP | `$client->listChannels()` |
| Python | `client.list_channels()` |
| Go | `client.ListChannels()` |

### 下单返回：统一 `payInfo`（按 `type` 渲染，别用渠道 if-else）

下单 / 查单返回里除了渠道原始的 `payParams`，还带一份**与渠道无关**的 `payInfo`：

```json
{ "type": "qrcode", "codeUrl": "weixin://wxpay/bizpayurl?...", "raw": { ... } }
```

| `type` | 含义 | 关键字段 | 前端动作 |
| --- | --- | --- | --- |
| `qrcode` | 扫码支付 | `codeUrl` | 用 `codeUrl` 生成二维码展示 |
| `jsapi` | 网页内唤起 | `params` | 微信 JSAPI：`params` 直接传给 `WeixinJSBridge` / JSSDK |
| `app` | App 内唤起 | `params` | 把 `params` 交给对应 App SDK |
| `redirect` | 跳转收银台 | `url` | `location.href = url`（PC/H5） |
| `form` | 网关表单 | `action` / `method` / `fields` | 自动 POST 提交（网银 / 银联前台交易） |
| `none` | 无需前端动作 | — | 条码付等已扣款场景，等异步通知即可 |

渲染模板（各语言通用思路）：

```
switch (payInfo.type) {
  case 'qrcode':   渲染二维码(payInfo.codeUrl); break;
  case 'jsapi':    唤起JSAPI(payInfo.params);   break;
  case 'app':      唤起App(payInfo.params);     break;
  case 'redirect': 跳转(payInfo.url);           break;
  case 'form':     自动提交表单(payInfo.action, payInfo.method, payInfo.fields); break;
  default:         // none / 未知形态：轮询查单等待结果，仍可用 payInfo.raw 自行兜底
}
```

未知 `type` 时**不要报错**，走 `default` 轮询查单 + `payInfo.raw` 兜底——这样即使将来出现新形态，老版本业务也不会崩。

**向前兼容约定**（平台侧承诺，SDK 因此在可预期范围内永不失效）：

1. 路径 `/api/v1/open/...` 与响应包裹 `{ code, message, data, traceId }` 长期不变
2. 只允许**新增可选字段**，不删除、不改变已有字段语义
3. 下单返回的 `payParams` 由渠道决定，业务侧应按「有 `codeUrl` 就生成二维码、有 `prepayId`/`params` 就唤起 SDK」的方式兜底渲染，不要用穷举渠道的 if-else
4. 未来确需破坏性变更时走 `/api/v2/...` 新路径，v1 继续可用

## 统一约定

- 接口全部为 `POST + JSON over HTTPS`，路径前缀 `/api/v1/open/...`
- 金额单位**元**，字符串，最多两位小数（`"128.50"`），禁止浮点运算
- 写接口均带幂等键（`merchantOrderNo` / `merchantRefundNo`），重试安全
- 响应 `code != 0` 时抛出对应语言的业务异常，携带 `code` 与 `traceId`
- 签名：`HMAC_SHA256(AppSecret, [appId, timestamp, nonce, METHOD, path, sha256Hex(body)].join('\n'))`，小写 hex
- 通知验签：`HMAC_SHA256(AppSecret, [appId, timestamp, nonce, sha256Hex(rawBody)].join('\n'))`

## Node.js

```js
const { createPayClient } = require('./pay-sdk-node.js');

const client = createPayClient({ baseUrl: 'https://pay.example.com', appId, appSecret });
const order = await client.createOrder({
  merchantOrderNo: 'ORDER_001',
  amount: '128.50',
  subject: '会员年卡',
  tradeType: 'NATIVE',
});
const detail = await client.queryOrder({ payOrderNo: order.payOrderNo });
```

## Java

把 `PayClient.java` 放进项目，改掉首行 `package com.example.pay;` 与你的包结构一致。

```java
PayClient client = new PayClient("https://pay.example.com", appId, appSecret);

Map<String, Object> order = client.createOrder(Map.of(
        "merchantOrderNo", "ORDER_001",
        "amount", "128.50",
        "subject", "会员年卡",
        "tradeType", "NATIVE"));

try {
    Map<String, Object> detail = client.queryOrder(Map.of("payOrderNo", order.get("payOrderNo")));
} catch (PayClient.PayException e) {
    // e.getCode() / e.getTraceId()
}
```

## PHP

```php
require_once __DIR__ . '/PayClient.php';

$client = new PayClient('https://pay.example.com', $appId, $appSecret);
$order = $client->createOrder([
    'merchantOrderNo' => 'ORDER_001',
    'amount'          => '128.50',
    'subject'         => '会员年卡',
    'tradeType'       => 'NATIVE',
]);
```

## Python

```python
from pay_client import PayClient, PayError

client = PayClient("https://pay.example.com", app_id, app_secret)
order = client.create_order({
    "merchantOrderNo": "ORDER_001",
    "amount": "128.50",
    "subject": "会员年卡",
    "tradeType": "NATIVE",
})
```

## Go

把 `payclient.go` 放进自己的模块目录（`package` 名可按需修改）。

```go
client := payclient.New("https://pay.example.com", appID, appSecret)
order, err := client.CreateOrder(map[string]any{
    "merchantOrderNo": "ORDER_001",
    "amount":          "128.50",
    "subject":         "会员年卡",
    "tradeType":       "NATIVE",
})
```

## 接收异步通知（务必验签）

通知请求头：`X-Pay-App-Id` / `X-Pay-Timestamp` / `X-Pay-Nonce` / `X-Pay-Sign` / `X-Pay-Trace-Id`。

各语言均提供 `verifyNotify` / `verify_notify` / `VerifyNotify`，传入**原始请求头**与**未经解析的原始 body 字符串**：

```php
if (!$client->verifyNotify(getallheaders(), file_get_contents('php://input'))) {
    http_response_code(401);
    exit;
}
```

```python
if not client.verify_notify(dict(request.headers), request.get_data(as_text=True)):
    return "invalid signature", 401
```

业务处理成功后返回 `{"code": 0}`；非 0 或超时会触发重试（1s / 5s / 30s / 5min / 30min / 2h / 6h）。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| 一直 `2004 签名校验失败` | 待签串顺序错、`path` 未含 `/api/v1/open/` 前缀、签名未转小写、body 被重新序列化过 |
| `1006 请求已过期` | 服务器时间偏差超过 300 秒，开启 NTP 校准 |
| `2006 nonce 重放` | 每次请求未生成新的随机 nonce |
| `2007 IP 不在白名单` | 后台应用配置里补充服务器出口 IP |
| `3008 幂等键冲突` | 同一 `merchantOrderNo` 的参数与首次请求不一致 |
