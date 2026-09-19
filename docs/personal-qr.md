# 个人收款码收款（personal_qr）

面向**没有商户号**的用户：上传自己的微信 / 支付宝收款二维码即可收款，
**业务系统拿到的回调参数与微信支付、支付宝等正式渠道完全一致**（同一套签名、同一套通知报文）。

---

## 一、它能做什么、不能做什么

| | 说明 |
| --- | --- |
| ✅ 能做 | 展示收款码收银台页、金额校验提示、付款人「我已支付」申报、收款方确认到账、**成功后异步通知业务系统**、查单、关单 |
| ✅ 零成本 | 不需要商户号、不需要密钥、不需要备案域名 |
| ❌ 不能自动到账确认 | 个人收款码**没有渠道回调**，支付中心无法知道钱有没有到账 |
| ❌ 不能自动退款 | 退款需收款方在自己的微信/支付宝账单里人工原路退回 |
| ❌ 不能自动对账 | 无渠道账单可下载，对账以人工核对为准（该渠道已排除在自动对账之外） |

### 因此流程是这样（关键差异：多一个「确认到账」环节）

```
业务系统下单(channel=personal_qr)
        ↓
payInfo = { type: 'redirect', url: 支付中心收银台页 }
        ↓ 付款人打开收银台页
展示收款码 + 金额 + 付款备注尾号 → 付款人扫码付款（钱直接进入收款方账户）
        ↓ 付款人点「我已支付」（仅申报，不改订单状态）
        ↓ 收款方在后台核对自己的微信/支付宝账单
后台点「确认到账」
        ↓
订单 SUCCESS → 异步通知业务系统（与正式渠道完全一致的回调）
```

> 付款人点「我已支付」**不会**把订单置为成功 —— 是否到账以收款方确认为准，避免虚假支付。

### ⚠️ 合规提醒

微信 / 支付宝的个人收款码协议上用于**个人间转账**，用于经营性收款存在被限制收款、降额甚至封停的风险；且这种模式下资金不经过支付中心，平台无法担保。建议：

- 小额、低频、非正式业务使用
- 有一定规模后走**正规通道**：微信支付「小微商户」、支付宝「当面付」（个人/个体工商户可入网，费率低，且**有正式回调**）
- 或接入第三方聚合码支付（个人可申请，同样有回调），按渠道适配器模式接入即可

---

## 二、配置（超管，一次性）

1. **后台 → 支付渠道 → 新增渠道**：渠道 `个人收款码(personal_qr)`，
   「收款账户备注」填如「张三-微信个人码」，`isSandbox` 保持关闭，启用
2. **后台 → 业务系统 → 收款码**：为该 AppId 上传收款码图片（走 `/api/admin/upload`），
   可上传多张（微信 / 支付宝），收银台页会自动分栏展示
3. 该业务系统的 `allowChannels` 需包含 `personal_qr`
4. **务必配置 `PAY_BASE_URL`**（系统设置站点地址）—— 收银台页地址由它拼出

接口（也可脚本化）：

```bash
# 登记收款码（imageUrl 来自上传接口）
POST /api/admin/personal-qr   { "appId":"app_xxx", "type":"wechat", "name":"张三-微信", "imageUrl":"/uploads/2026/09/xxx.webp" }
GET  /api/admin/personal-qr?appId=app_xxx
PUT  /api/admin/personal-qr/:id     { "enabled": false }
DELETE /api/admin/personal-qr/:id
```

---

## 三、下单（业务系统侧，与其它渠道完全一样）

```js
const order = await client.createOrder({
  merchantOrderNo: 'SHOP_20260920_0001',
  amount: '6.66',
  subject: '会员充值',
  channel: 'personal_qr',     // 或不传，由支付中心路由
  tradeType: 'NATIVE',
});
// order.payInfo = { type: 'redirect', url: 'https://pay.7zan.com/qr/cashier?pay_order_no=P...' }
// 把用户跳到 url 即可（PC 展示二维码，手机端提示长按识别）
```

`payParams` 里还给了 `codes`（收款码图片集合）与 `payRemark`（订单号后 6 位）——
业务系统若想自己渲染收银台，可直接用这些数据，不必跳转我们的页面。

---

## 四、确认到账（收款方）

- **后台**：订单查询 → 该订单（渠道=个人收款码）→「确认到账」（可填实际到账金额 / 付款账号）
- **接口**：`POST /api/admin/orders/:payOrderNo/confirm-paid`，body `{ "paidAmount":"6.66", "payerId":"wx1234", "remark":"微信账单核对无误" }`

确认后：订单置 SUCCESS → 立即异步通知业务系统，报文示例：

```json
{
  "bizType": "PAY",
  "event": "PAYMENT_SUCCESS",
  "payOrderNo": "P202609200413440000173f",
  "merchantOrderNo": "SHOP_202609200001",
  "appId": "app_xxx",
  "amount": "6.66",
  "paidAmount": "6.66",
  "status": "SUCCESS",
  "channel": "personal_qr",
  "paidAt": "2026-09-20T04:14:02.000Z",
  "extra": { "source": "admin-confirm", "operator": "admin", "remark": "微信账单核对无误" }
}
```

未收到钱就别确认；误确认可走退款/人工流程，订单一旦 SUCCESS 就会通知业务系统发货。

---

## 五、接口一览

| 接口 | 说明 |
| --- | --- |
| `GET /qr/cashier?pay_order_no=` | 收银台页（展示收款码、金额、状态轮询、申报按钮） |
| `GET /api/v1/qr/pay/:payOrderNo/status` | 订单状态（收银台页轮询） |
| `POST /api/v1/qr/pay/:payOrderNo/mark` | 付款人申报「我已支付」{ payerAccount } |
| `POST /api/admin/orders/:payOrderNo/confirm-paid` | 后台确认到账 → 置成功并发通知 |
| `POST /api/admin/orders/:payOrderNo/close` | 关单（未收到款时用） |
| `GET/POST/PUT/DELETE /api/admin/personal-qr` | 收款码管理 |

---

## 六、常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 下单报「未配置个人收款码」 | 该 AppId 下没有启用中的收款码，去后台上传 |
| 收银台页地址不对 | 未配置 `PAY_BASE_URL`，地址会退化成相对路径 |
| 付款人付了但订单一直不成功 | 正常：需要收款方在后台点「确认到账」 |
| 申请退款被拒 | 个人码无渠道退款能力，请人工原路退回 |
| 对账出现该渠道订单 | 该渠道已排除自动对账，按人工核对处理 |
| 想全自动回调 | 改走微信小微商户 / 支付宝当面付 / 第三方聚合码（有正式回调） |
