# 统一支付中心 · 多语言 SDK

全部 SDK **零第三方依赖**（只用各语言标准库 / 运行时自带能力），单文件即可使用，可直接拷贝进业务项目。

| 语言 | 文件 | 运行环境要求 | 依赖 |
| --- | --- | --- | --- |
| Node.js | `pay-sdk-node.js`（仓库 `docs/sdk-node.js`） | Node 18+（自带 fetch） | 无 |
| Java | `PayClient.java` | JDK 11+ | 无（HttpClient + 内置 JSON 读写） |
| PHP | `PayClient.php` | PHP 7.4+ | 仅 curl 扩展 |
| Python | `pay_client.py` | Python 3.8+ | 无（urllib） |
| Go | `payclient.go` | Go 1.18+ | 无（net/http） |

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
