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

## 2. 建库建表：全自动（启动即自愈）

后端**在 Nest 容器初始化之前**执行 `ensureSchema()`（`src/common/prisma/schema-init.ts`），三步全自动：

1. **自动建库**：用原生驱动（mysql2）以不带库名的连接执行
   `CREATE DATABASE IF NOT EXISTS <db> DEFAULT CHARACTER SET utf8mb4` —— Prisma 本身不建库，这一层是补齐的。
2. **自动建表**：扫描 `prisma/migrations/*/migration.sql`，按目录名升序执行未应用的迁移。全新库 → 一次建完全部表（当前基线 `20260920000000_init`）。
3. **升级补全**：新版本带来的增量迁移（加表 / 加列 / 加索引）在**下次启动时自动应用**，无需手工执行任何命令。

记录与兼容：

- 本 runner 维护记录表 `_schema_migrations`（迁移名 + checksum + 时间），重复启动只跳过不重复执行。
- 兼容 Prisma CLI：会读取 `_prisma_migrations` 中已完成的迁移并跳过，所以手工 `migrate deploy` 过的库不会被执行第二遍。
- ⚠️ 反向不成立：若某库先由 runner 建表，之后手工跑 `prisma migrate deploy` 会报 `P3005`（表已存在），此时打基线即可：
  ```bash
  npx prisma migrate resolve --applied 20260920000000_init
  ```

开关与路径：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SCHEMA_AUTO_INIT` | `true` | `false` 关闭自愈（改由 DBA 手工执行迁移） |
| `MIGRATIONS_DIR` | `prisma/migrations` | 迁移脚本目录 |

⚠️ 部署形态要求：runner 需要读到迁移 SQL 文件。若只部署 `dist/`，必须**同时把 `prisma/migrations` 目录拷到服务器**（或用 `MIGRATIONS_DIR` 指向），否则启动日志会报「数据库结构不完整，缺少表: ...」。

**初始数据**：后端启动还会自动 `ensureSuperAdmin()` 创建 `admin / Pay@admin123`；`npm run seed` 只是额外写入渠道占位配置（mock + 微信/支付宝待配置），可跳过，在后台「渠道配置」页手工建也一样。

### 开发时如何产出迁移（升级补全的来源）

改完 `prisma/schema.prisma` 后，在开发机生成并提交迁移 SQL，线上启动时就会自动应用：

```bash
npm run prisma:migrate -- --name add_xxx_column   # 生成 prisma/migrations/<时间戳>_add_xxx_column/migration.sql
git add prisma/migrations && git commit
```

禁止在服务器用 `prisma db push` 兜底（生产有数据丢失风险，且不会进迁移历史）。

### 首次安装向导（全新部署 / 换机器）

仓库同步下来还没有可用配置时，后端以「未安装」状态启动：除 `/api/install/*` 外所有接口返回 503（`INSTALL_REQUIRED`），管理后台打开即自动跳到 `#/install`。

向导四步：

1. **环境检测**：Node 版本 / 配置文件可写 / 存储目录可写 / 数据库连通性
2. **数据库**：主机、端口、账号、密码、**数据库名（可自定义，不存在会自动创建）**；「测试连接」实时探测目标库是否已存在、账号是否具备建库权限
3. **站点与管理员**：对外地址 `PAY_BASE_URL`、渠道模式（沙箱/生产）、加密主密钥（留空自动生成 32 字节）、Redis（可选）、管理员账号密码
4. **完成**：写 `.env` → 建库建表（自动应用迁移）→ 创建超管 → 落 `storage/installed.lock` → 触发一次重启 → 进入登录

要点：

- 数据库以分项形式写入（DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME），启动时自动组装为 `DATABASE_URL`；若原 `.env` 里有整串 `DATABASE_URL`，向导会将其注释掉，保证自定义库名生效。
- 安装完成后**需重启一次进程**让 Prisma 加载新连接串（向导会调用 `/api/install/restart` 自动触发，PM2 / systemd / docker 会自动拉起；直接 `node` 运行的需手动启动）。
- 安装标记 `storage/installed.lock` 存在后安装接口自动关闭（重复安装返回 1011）；需重装就删掉该文件和 `.env` 再重启。
- 既有部署升级不会触发向导：启动时若能连上库且 `admin_user` 表已存在，即视为已安装。

## 3. 首次部署步骤

```bash
# 0) 环境：Node >= 20
node -v

# 1) MySQL / Redis（已有自建实例可跳过）
docker compose up -d mysql redis

# 2) 建库：可跳过（后端启动会自动 CREATE DATABASE）
#    仅当数据库账号无建库权限时才需 DBA 预先建好库

# 3) 配置环境变量
cp .env.example .env
# 必改：DATABASE_URL / REDIS_ENABLED=true / MASTER_KEY(32字节) / JWT_SECRET / PAY_BASE_URL(https 域名)
# 生产：DEFAULT_CHANNEL_MODE=prod（关闭 Mock 强制代理）

# 4) 安装依赖 + 生成 Prisma Client
npm ci
npx prisma generate
# 建表可跳过：后端启动时自动应用迁移（SCHEMA_AUTO_INIT 默认开启）
npx prisma migrate deploy
npm run seed            # 可选：渠道占位配置；超管账号启动时会自建

# 5) 构建并启动后端
npm run build
pm2 start dist/src/main.js --name pay-center -i 1   # 注意产物在 dist/src/ 下
# 部署 dist 时必须同时拷贝 prisma/migrations（结构自愈要读迁移 SQL）
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
