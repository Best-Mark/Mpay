# 服务器部署说明

## 1. 服务器上要跑什么

| 组件 | 是否必须 | 说明 |
| --- | --- | --- |
| MySQL 8.0 | 必须 | 唯一持久化存储（订单/退款/账单/对账/后台账号） |
| Redis 7 | 强烈建议 | 分布式锁、Nonce 防重放、限流；`REDIS_ENABLED=false` 可降级为进程内实现，**但多实例部署必须开启** |
| Node 服务（后端） | 必须 | `node dist/main`，PM2 守护；内含所有定时任务 |
| 管理后台静态站点 | 必须（可选方式） | `admin/dist`，Nginx 托管或 `npx serve dist`；后端不托管前端 |

端口：后端默认 `3000`（`PORT`），MySQL `3306`，Redis `6379`。对外只需暴露 **443（Nginx）** 与后端健康检查。

服务进程内的定时任务（无独立 worker，后端常驻即生效）：

| 任务 | 频率 | 说明 |
| --- | --- | --- |
| 关闭超时未支付订单 | 每分钟 | `payment.service.ts` |
| 支付中订单主动查单补偿 | 每 3 分钟 | 防渠道回调丢失 |
| 退款处理中补偿查单 | 每 5 分钟 | `refund.service.ts` |
| 通知失败重投 | 每 20 秒 | 用 status 条件更新，多实例不会重复捞取 |
| 拉取渠道账单 | `BILL_FETCH_CRON`（默认 07:00） | `reconcile.service.ts` |
| 每日自动对账 | `RECONCILE_CRON`（默认 06:30 对前一日） | 有 Redis 分布式锁，多实例只跑一个 |

多实例注意：定时任务在每个实例都会触发，靠 Redis 锁保证不并发（未开 Redis 时**只部署 1 个实例**）；也可给非主实例设 `RECONCILE_AUTO_ENABLED=false` 只保留主实例跑对账。

## 2. 数据库会自动建吗

分三层，别混淆：

1. **库（database）不会自动建**：Prisma 不执行 `CREATE DATABASE`。需先手动建库（字符集 `utf8mb4`）：
   ```sql
   CREATE DATABASE pay_center CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
   用 `docker compose up -d mysql` 时由 `MYSQL_DATABASE=pay_center` 自动创建，可省这一步。
2. **表会自动建**：仓库已包含初始迁移 `prisma/migrations/20260920000000_init/migration.sql`，在**空库**上执行即可建全部表：
   ```bash
   npx prisma migrate deploy
   ```
   ⚠️ 若库里已有旧表（此前用 `prisma db push` 建过），先打基线再部署，否则报 `P3005`：
   ```bash
   npx prisma migrate resolve --applied 20260920000000_init
   ```
3. **初始数据**：后端启动时 `main.ts` 会自动 `ensureSuperAdmin()` 创建 `admin / Pay@admin123`（表不存在时会 warn 但不阻断启动）；`npm run seed` 额外写入渠道占位配置（mock + 微信/支付宝待配置），可跳过，在后台「渠道配置」页手工建也一样。

## 3. 首次部署步骤

```bash
# 0) 环境：Node >= 20
node -v

# 1) MySQL / Redis（已有自建实例可跳过）
docker compose up -d mysql redis

# 2) 建库（docker 方式已自动建，可跳过）
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS pay_center CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 3) 配置环境变量
cp .env.example .env
# 必改：DATABASE_URL / REDIS_ENABLED=true / MASTER_KEY(32字节) / JWT_SECRET / PAY_BASE_URL(https 域名)
# 生产：DEFAULT_CHANNEL_MODE=prod（关闭 Mock 强制代理）

# 4) 安装依赖 + 生成 Prisma Client + 建表
npm ci
npx prisma generate
npx prisma migrate deploy
npm run seed            # 可选

# 5) 构建并启动后端
npm run build
pm2 start dist/main.js --name pay-center -i 1   # 多实例需 Redis，见第 1 节
pm2 save && pm2 startup

# 6) 构建并托管管理后台
cd admin && npm ci && npm run build
# 产物 admin/dist 交给 Nginx（见下）
```

## 4. Nginx 示例

```nginx
server {
  listen 443 ssl http2;
  server_name pay.example.com;

  # 管理后台静态站点
  root /var/www/pay/admin/dist;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }

  # 后端 API（含开放接口与渠道回调）
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

要点：
- 后端信任 `X-Forwarded-For` 做 IP 白名单，反向代理必须透传真实 IP。
- 渠道回调地址由 `PAY_BASE_URL` 拼接（如 `https://pay.example.com/api/v1/notify/wechat/pay`），必须与微信/支付宝后台配置一致。
- 微信证书放 `certs/wechat/`，支付宝密钥放 `certs/alipay/`（路径由 env 指定），不要进 Git。

## 5. 上线后自检

```bash
curl https://pay.example.com/api/admin/health      # { db: ok }
node scripts/smoke-test.mjs                        # 全链路冒烟（登录/下单/支付/退款/对账）
```

`smoke-test.mjs` 第一个参数为基址，默认 `http://localhost:3000`，线上直接传域名：
```bash
node scripts/smoke-test.mjs https://pay.example.com
```

## 6. 生产检查清单

- [ ] `MASTER_KEY`、`JWT_SECRET`、`NOTIFY_SIGN_SALT` 已换成随机值（换来后旧加密数据不可解，须在空库阶段换）
- [ ] 默认管理员密码已改
- [ ] `DEFAULT_CHANNEL_MODE=prod`，Mock 渠道不再代理真实渠道
- [ ] `REDIS_ENABLED=true`（多实例）
- [ ] `BILL_STORE_DIR` 所在磁盘可写且有备份
- [ ] 对账 cron 早于业务对账时间、晚于渠道出账时间（微信约 09:00 出前日账单，默认 07:00 拉账可能拉不到，按需调整为 `0 10 * * *`）
- [ ] MySQL 定期备份；订单/账单保留 3 年以上
