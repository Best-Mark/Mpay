# Mpay · 统一支付中心

> 一个业务系统只需接入一次，收银、退款、对账全部搞定。
> 渠道密钥集中在支付中心管理，业务系统零密钥、零渠道知识。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 统一收单 | 下单 / 查询 / 关单，业务系统只传「业务订单号 + 金额 + 通知地址」 |
| 统一退款 | 全额 / 部分退款，幂等防重复，失败自动重试 |
| 可靠通知 | 支付/退款结果异步通知业务系统，指数退避重试 + 死信人工重投 |
| **自动对账** | 每日自动拉取渠道账单 → 解析入库 → 双向核对 → 差异分类 → 报告 → Excel 导出 |
| 管理后台 | 订单 / 退款 / 渠道配置 / 业务系统 / 对账中心 / 差异处理 / 操作日志 |
| 安全 | 接口 HMAC-SHA256 签名 + 时间戳防重放，渠道密钥 AES-256-GCM 加密落库，后台 JWT |

## 技术栈

- **后端** NestJS + TypeScript + Prisma + MySQL 8 + Redis（可降级为内存锁）
- **前端** Vue 3 + Element Plus + Vite（PC / 移动端自适应）
- **渠道** 微信支付 V3（APIv3 证书 + 验签 + 账单解密）、支付宝（网关签名 + 对账单解析）、Mock（本地联调）

## 快速开始

```bash
# 1. 启动 MySQL / Redis（或使用自建实例）
docker compose up -d mysql redis

# 2. 配置环境变量
cp .env.example .env       # 修改 DATABASE_URL / REDIS_URL / MASTER_KEY / JWT_SECRET

# 3. 安装 & 初始化
npm install
npx prisma migrate deploy  # 或 npx prisma db push（开发期）
npm run seed

# 4. 启动
npm run start:dev          # 后端 http://localhost:3000，文档 /docs
cd admin && npm install && npm run dev   # 管理后台 http://localhost:5173
```

默认管理员 `admin / Pay@admin123`（首次登录后立即修改）。

## 目录结构

```
src/
├── common/            # 错误码 / 枚举 / 金额与单号工具 / 加解密 / 拦截器 / 操作日志
├── modules/
│   ├── auth/          # 对外接口签名鉴权（AppKey + HMAC-SHA256 + 防重放）
│   ├── merchant/      # 业务系统管理（AppId/AppSecret/IP 白名单/权限）
│   ├── channel/       # 渠道适配层（wechat / alipay / mock 可插拔）
│   ├── payment/       # 支付核心（下单/查询/关单/回调状态机/超时关单）
│   ├── refund/        # 退款（全额/部分、幂等、重试）
│   ├── notify/        # 可靠通知中心（重试/死信/人工重投）+ 渠道回调入口
│   ├── reconcile/     # ★ 对账引擎（拉单/解析/核对/差异分类/报告/导出/定时）
│   ├── admin/         # 管理后台 API（JWT 鉴权 + 角色控制）
│   └── mock/          # 模拟收银台（sandbox 跑通全链路）
admin/                # Vue3 管理后台前端
prisma/               # 数据模型与种子数据
```

## 对账引擎（核心）

```
每日 07:00 自动拉单 ──► 06:30 自动对账（cron 可配）
        │                    │
        ▼                    ▼
  渠道账单解析入库      双向匹配核对
  (标准化 Trade/Refund)  (订单号+金额+状态)
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
          平账(PASS)    差异分类入库     差异超阈值告警
                       ┌─────────────────────────┐
                       │ CHANNEL_ONLY  长款(高危) │→ 人工确认后【补单】
                       │ CENTER_ONLY   短款(高危) │→ 人工确认后【冲正】
                       │ AMOUNT_DIFF   金额不符   │→ 核实处理
                       │ STATUS_DIFF   状态不符   │→ 核实处理
                       │ DUPLICATE     重复支付   │→ 核实处理
                       │ REFUND_DIFF   退款差异   │→ 核实处理
                       └─────────────────────────┘
                             │
                     对账报告(汇总+明细)
                     Excel 导出 / 操作留痕
```

- 差异处理四动作：**确认平账 / 补单 / 冲正 / 忽略**，全部记录操作日志（操作前后快照）。
- 同一「日期+渠道」分布式锁防并发对账（支持多实例部署）。
- 手动补拉：渠道下载失败时可在后台直接上传账单文件。

## 业务系统接入

```
POST /api/v1/payment/create      统一下单
POST /api/v1/payment/query       订单查询
POST /api/v1/payment/close       关闭订单
POST /api/v1/refund/create       申请退款
POST /api/v1/refund/query        退款查询
POST ← /api/v1/notify/*          支付中心 → 业务系统（支付/退款结果，签名可验）
```

签名规则（摘要，完整见 `docs/api-guide.md`）：

```
X-App-Id / X-Timestamp / X-Nonce / X-Sign
sign = HMAC_SHA256(appSecret, appId + timestamp + nonce + body)
```

## 部署

```bash
npm run build && npm run start:prod        # 后端（PM2 推荐）
cd admin && npm run build                  # 前端产物 dist/ 由 Nginx 或后端托管
npx prisma migrate deploy                  # 数据库迁移
```

生产检查清单：修改 MASTER_KEY / JWT_SECRET / 默认管理员密码；DEFAULT_CHANNEL_MODE=prod 关闭 Mock；配置 HTTPS；核对账单 cron 与对账 cron。

## 数据保留

支付订单、退款单、渠道账单、对账报告默认保留 3 年以上，`ArchiveService` 预留按年归档接口。
