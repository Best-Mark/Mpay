/**
 * .env 读写 与 数据库连接串组装（不引入 dotenv，保持零额外依赖）
 *
 * 环境变量优先级：进程已有值 > .env 文件
 * 数据库支持两种配置方式（二选一）：
 *   1) 整串：DATABASE_URL="mysql://user:pass@host:3306/db?..."
 *   2) 分项：DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME  ← 库名可自定义，安装向导用这种方式
 */
import * as fs from 'fs';
import * as path from 'path';

export const ENV_FILE = process.env.ENV_FILE || '.env';

/** 首次安装生成 .env 时使用的模板（带分组注释，便于人工维护） */
const TEMPLATE = `# ========== 服务 ==========
NODE_ENV=production
PORT=3000
# 对外访问的支付中心地址（用于拼接渠道异步回调地址）
PAY_BASE_URL=
# 管理后台/开放接口是否开启限流
RATE_LIMIT_ENABLED=true
# 反向代理信任跳数：nginx 反代下填 1（只信任最后一跳，忽略客户端伪造的 XFF）；直连填 0
TRUST_PROXY=1

# ========== 数据库 ==========
# 分项配置（库名可自定义），启动时自动组装为 DATABASE_URL
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=
# 也可直接写整串（填写后优先于上面的分项）
# DATABASE_URL="mysql://user:pass@host:3306/pay_center?connection_limit=20&pool_timeout=30"
# 启动时自动建库/建表/应用增量迁移
SCHEMA_AUTO_INIT=true

# ========== Redis（可选：不配置则降级为进程内实现）==========
REDIS_ENABLED=false
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# ========== 安全 ==========
# 敏感字段（商户私钥、AppSecret）加密存储用的主密钥，32 字节
MASTER_KEY=
# 回调通知签名密钥（salt）
NOTIFY_SIGN_SALT=

# ========== 渠道 ==========
DEFAULT_CHANNEL_MODE=sandbox

# ========== 存储 ==========
BILL_STORE_DIR=./storage/bills
`;

/** 解析 KEY=VALUE（忽略注释、去引号） */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(idx + 1).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** 读取 .env 并填充到 process.env（不覆盖已存在的进程变量） */
export function loadEnvFile(file = ENV_FILE): Record<string, string> {
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) return {};
  const parsed = parseEnv(fs.readFileSync(abs, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return parsed;
}

function quote(v: string): string {
  return /[\s"']/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/**
 * 增量写入 .env：已存在的键原地替换，新键追加到末尾，注释与结构保留
 * 值为 null 表示「注释掉该键」（安装时用于让分项配置生效、清掉旧的整串 DATABASE_URL）
 * 同时同步到 process.env（使本次进程内立即可用）
 */
export function patchEnvFile(patch: Record<string, string | null>, file = ENV_FILE): void {
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, TEMPLATE, 'utf8');
  }
  const rest: Record<string, string | null> = { ...patch };
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  const out = lines.map((line) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line.trim());
    if (!m) return line;
    const key = m[1];
    if (!Object.prototype.hasOwnProperty.call(rest, key)) return line;
    const val = rest[key];
    delete rest[key];
    if (val === null) return line.trim().startsWith('#') ? line : `# ${line}`;
    return `${key}=${quote(val)}`;
  });
  const remaining = Object.entries(rest).filter(([, v]) => v !== null) as [string, string][];
  if (remaining.length) {
    out.push('', '# ===== 安装向导写入 =====');
    for (const [k, v] of remaining) out.push(`${k}=${quote(v)}`);
  }
  fs.writeFileSync(abs, out.join('\n').replace(/\n+$/, '') + '\n', 'utf8');
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
}

/** 分项配置 → 完整连接串；已配置 DATABASE_URL 时以其为准 */
export function composeDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const host = env.DB_HOST;
  const name = env.DB_NAME;
  if (!host || !name) return null;
  const user = encodeURIComponent(env.DB_USER || 'root');
  const pass = encodeURIComponent(env.DB_PASSWORD || '');
  const port = env.DB_PORT || '3306';
  return `mysql://${user}:${pass}@${host}:${port}/${name}?connection_limit=20&pool_timeout=30`;
}

/** 当前生效的数据库分项配置（用于安装向导回显，密码只返回是否已设置） */
export function currentDbConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = env.DATABASE_URL;
  if (url) {
    try {
      const u = new URL(url);
      return {
        host: u.hostname,
        port: Number(u.port || 3306),
        user: decodeURIComponent(u.username || 'root'),
        database: decodeURIComponent(u.pathname.replace(/^\//, '')),
        passwordSet: !!u.password,
      };
    } catch {
      /* 落到分项读取 */
    }
  }
  return {
    host: env.DB_HOST || '',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || '',
    database: env.DB_NAME || '',
    passwordSet: !!env.DB_PASSWORD,
  };
}
