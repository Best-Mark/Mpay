# 多项目统一接入规范

> 面向公司内所有需要收款的项目。照本规范接入后：新增支付渠道、新增收银台形态、支付中心升级，**业务项目代码与 SDK 都不需要改**。
> 配套工具：`scripts/provision-app.mjs`（批量开通业务系统）、`scripts/onboard-check.mjs`（接入自检）。

---

## 1. 总体模型

```
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│  Mshop 商城 │ │ MoneySite  │ │ 七赞云主题  │ │  新项目 …   │
│  app_xxxx1 │ │  app_xxxx2 │ │  app_xxxx3 │ │  app_xxxx4 │
└─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
      │  各自 AppId/密钥、各自通知地址、各自 IP 白名单
      └──────────────┴──────────────┴──────────────┘
                             │
                 统一支付中心（本仓库）
            收单 / 退款 / 通知 / 对账 / 渠道密钥集中管理
                             │
                    微信支付 · 支付宝 · …
```

- **一个「项目 × 环境」= 一个业务系统（AppId）**：订单、退款、通知、对账天然隔离
- **业务系统零渠道密钥、零渠道知识**：微信证书、支付宝密钥只在支付中心
- 某项目密钥泄露 → 只重置它自己的 Secret；某项目停用 → 不影响他人

### 环境拆分（强制）

| 环境 | AppId 命名建议 | 允许渠道 | 用途 |
| --- | --- | --- | --- |
| 生产 | `<项目>-生产` | wechat / alipay（按业务需要） | 真实资金 |
| 测试 | `<项目>-测试` | **仅 mock** | 联调、回归，不出真钱 |

测试环境务必只开 `mock` 渠道 —— 防止误配把测试订单打到真实渠道。

---

## 2. 接入流程（平台侧 → 项目侧）

| # | 谁做 | 动作 |
| --- | --- | --- |
| 1 | 项目 | 提供：项目名、语言、支付/退款通知地址（HTTPS）、服务器出口 IP、需要的渠道、单笔限额 |
| 2 | 超管 | `npm run provision:app -- --apps scripts/apps.json` 批量开通（或后台「业务系统」手动建） |
| 3 | 超管 | 通过安全渠道交付 `appId / appSecret`（明文只出现一次，存进公司密码库） |
| 4 | 项目 | 把对应语言的 SDK 单文件拷进项目（`docs/sdk/`），按第 4 节实现下单 / 通知 / 查单 |
| 5 | 项目 | 跑 `node scripts/onboard-check.mjs ...` 自检，全部 ✅ 才算接入完成 |
| 6 | 超管 | 切生产：后台把该应用的渠道从 mock 放开到真实渠道，**项目代码零改动** |

---

## 3. 命名与数据规范（跨项目统一，务必遵守）

| 项 | 规范 | 原因 |
| --- | --- | --- |
| `merchantOrderNo` | `<项目前缀>_<业务单号>`，如 `MSHOP_20260920_0001`；同 appId 内唯一 | 幂等键 + 对账关联键，跨项目重名会撞车 |
| `merchantRefundNo` | `<项目前缀>R_<业务退款单号>` | 退款幂等键 |
| 金额 | **字符串**，单位元，两位小数（`"128.50"`） | 禁止浮点，避免分账误差 |
| `subject` | 真实商品标题（会展示在渠道账单与对账单上） | 对账与客诉排查 |
| `extra` | 放业务侧需要的透传字段（如 userId、业务类型），通知时原样回传 | 业务解耦，不要塞进 merchantOrderNo |
| `channel` | **不传 / `auto`**，由支付中心路由；禁止写死 | 新增渠道自动生效 |
| 收银台渲染 | 按 `payInfo.type` 分支，未知 type 走「轮询查单」兜底 | 新增形态不崩 |

---

## 4. 服务端接入要点（六条铁律）

1. **金额全程字符串**，任何加减乘除用 `decimal.js` / `BigDecimal` / `bcmath`，不用浮点
2. **不写死渠道**：下单不传 `channel`；收银台渠道列表用 `listChannels()` 动态拉
3. **按 `payInfo.type` 渲染**（`qrcode` / `jsapi` / `app` / `redirect` / `form` / `none`），不做渠道 if-else
4. **写接口必带幂等键**（`merchantOrderNo` / `merchantRefundNo`），失败重试安全
5. **通知必须验签 + 幂等 + 回 `{"code": 0}`**：以 `payOrderNo` 去重，重复通知直接返回成功
6. **查单兜底**：支付后 5s / 30s / 5m 轮询 `pay/query`，防止通知丢失导致订单卡死

### 4.1 下单（Node 示例，其它语言只是方法名不同）

```js
const { createPayClient } = require('./pay-sdk-node.js');
const client = createPayClient({ baseUrl: 'https://pay.7zan.com', appId, appSecret });

const order = await client.createOrder({
  merchantOrderNo: 'MSHOP_20260920_0001',   // 项目前缀 + 业务单号
  amount: '128.50',                          // 字符串
  subject: '会员年卡',
  tradeType: 'NATIVE',                       // JSAPI / NATIVE / APP / MINI / PAGE
  extra: { userId: 123, bizType: 'vip' },    // 透传，通知原样回传
});

switch (order.payInfo.type) {
  case 'qrcode':   showQrcode(order.payInfo.codeUrl); break;
  case 'jsapi':    invokeJsapi(order.payInfo.params); break;
  case 'redirect': location.href = order.payInfo.url; break;
  case 'form':     autoSubmit(order.payInfo);         break;
  default:         pollQuery(order.payOrderNo);       // 未知形态：轮询兜底，别报错
}
```

| 语言 | 下单 |
| --- | --- |
| Java | `client.createOrder(Map.of(...))` |
| PHP | `$client->createOrder([...])` |
| Python | `client.create_order({...})` |
| Go | `client.CreateOrder(map[string]any{...})` |

### 4.2 接收通知（模板，各语言同理）

```js
app.post('/api/pay/notify', express.raw({ type: '*/*' }), async (req, res) => {
  const raw = req.body.toString('utf8');                 // 必须拿原始 body，不能 parse 后再 stringify

  if (!client.verifyNotify({ headers: req.headers, rawBody: raw })) {
    return res.status(401).end();                        // 验签失败：直接 401
  }

  const n = JSON.parse(raw);
  if (n.bizType === 'REFUND' && n.event === 'REFUND_SUCCESS') { await onRefund(n); }
  else if (n.bizType === 'PAY' && n.event === 'PAYMENT_SUCCESS') { await onPaid(n); }

  res.json({ code: 0 });                                 // 必须是这个，否则平台判失败并重试
});

// 幂等：以 payOrderNo 去重，重复通知直接返回
async function onPaid(n) {
  const done = await db.payLog.exists(n.payOrderNo);
  if (done) return;                                      // ← 重复通知，直接忽略
  await db.tx(async () => {
    await db.order.markPaid(n.merchantOrderNo, n.paidAmount);
    await db.payLog.insert(n.payOrderNo, n);
  });
}
```

通知头：`X-Pay-App-Id` / `X-Pay-Timestamp` / `X-Pay-Nonce` / `X-Pay-Sign` / `X-Pay-Trace-Id` / `X-Pay-Biz-Type`（`PAY` / `REFUND`）
报文类型字段：`bizType`（`PAY` / `REFUND`）+ `event`（`PAYMENT_SUCCESS` / `REFUND_SUCCESS` / `REFUND_FAILED`）+ `status`
验签串：`[appId, timestamp, nonce, sha256Hex(原始body)].join('\n')`，HMAC-SHA256 小写 hex
成功标识：`{"code": 0}`（或 `{"success": true}` / 文本 `SUCCESS`）
失败重试：`1s / 5s / 30s / 5min / 30min / 1h / 2h / 6h`，最多 8 次，之后进死信（后台可人工重投）

---

## 5. 自检（接入完成的判定标准）

项目侧把自己的凭证与通知地址填进去跑：

```bash
# 只验开放接口（无需公网）
node scripts/onboard-check.mjs --base https://pay.7zan.com --app-id app_xxx --app-secret sss

# 连自己的通知处理器一起验（需要一条公网隧道，如 ngrok / cloudflared）
node scripts/onboard-check.mjs --base https://pay.7zan.com --app-id app_xxx --app-secret sss \
  --public-base https://abcd.ngrok-free.app --port 8787 \
  --forward http://localhost:3000/api/pay/notify
```

检查项：渠道发现 → 下单 → 幂等 → 错签拒绝 → 模拟支付 → 查单 SUCCESS → 部分退款 → 查退款 → 关单 → **通知送达 + 验签通过 + 字段完整 + 应答为成功标识 + 重放仍幂等**。

验收清单（项目自测，全打勾才可上生产）：

- [ ] 金额全程字符串，未出现浮点运算
- [ ] `merchantOrderNo` 带项目前缀且全局唯一
- [ ] 未写死 `channel`；收银台渠道动态拉取
- [ ] 渲染按 `payInfo.type` 分支，`default` 有轮询兜底
- [ ] 通知处理先验签，再幂等落库，最后返回 `{"code": 0}`
- [ ] 通知重复投递 2 次，业务数据不重复（自检脚本已自动验）
- [ ] 断网/超时场景有查单兜底轮询
- [ ] 支付中心后台「订单」页能看到本项目订单，`appId` 正确
- [ ] 服务器出口 IP 已加入白名单

---

## 6. 运维与应急

| 场景 | 处理 |
| --- | --- |
| 密钥疑似泄露 | 超管后台「业务系统 → 重置 AppSecret」，项目只需更新配置，代码不动 |
| 通知没收到 | 后台「通知任务」查状态；失败/死信可一键重投；同时项目用 `pay/query` 兜底 |
| 服务器换 IP | 后台补充 IP 白名单（不配白名单则放行，但建议配） |
| 新增渠道 | 超管后台配置渠道 + 放开应用渠道；**项目代码零改动**，收银台自动多出选项 |
| 长款/短款 | 对账中心每日自动核对，差异分类入库；人工「补单 / 冲正 / 确认平账 / 忽略」 |
| 排查问题 | 提供 `traceId`（响应体与 `X-Pay-Trace-Id` 均带），后台可全链路定位 |

## 7. 常见问题

| 现象 | 原因 |
| --- | --- |
| `2004` 签名错误 | 待签串顺序错、`path` 未含 `/api/v1/open/` 前缀、签名未转小写、body 被重新序列化 |
| `1006` 请求已过期 | 服务器时间偏差 > 300s，开 NTP |
| `2006` nonce 重放 | 每次请求未生成新 nonce |
| `2007` IP 不在白名单 | 后台补出口 IP 或用代理后的真实 IP |
| `3008` 幂等键冲突 | 同一 `merchantOrderNo` 参数与首次不一致（金额改了却复用了单号） |
| 通知一直重试 | 应答不是 `{"code": 0}`（如返回了 `{"code":"SUCCESS"}`），或处理超时 > 5s |
