/**
 * 数据库结构自愈（启动前置，不依赖 Nest 容器）
 *
 * 三件事，按序执行，任何一步失败都只上抛不吞错（由调用方决定是否阻断启动）：
 *   1. 自动建库：Prisma 不会 CREATE DATABASE，此处用原生驱动补上
 *   2. 自动建表：执行 prisma/migrations 下尚未应用的迁移（全新库 → 建全部表）
 *   3. 升级补全：新版本带来的增量迁移（加表/加列/加索引）在启动时自动应用
 *
 * 与 `npx prisma migrate deploy` 的关系：
 *   - 本 runner 维护自己的记录表 `_schema_migrations`
 *   - 同时兼容 Prisma CLI 的 `_prisma_migrations`：CLI 已应用过的迁移会跳过，不会重复执行
 *   - 若某库先由本 runner 建表，之后再手工跑 `migrate deploy` 会报 P3005（表已存在），
 *     此时执行 `npx prisma migrate resolve --applied <迁移名>` 打基线即可
 *
 * 开关：SCHEMA_AUTO_INIT=false 关闭（默认开启）
 * 迁移目录：默认 prisma/migrations，可用 MIGRATIONS_DIR 覆盖
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import mysql from 'mysql2/promise';

/** 核心表，用于建表后的完整性校验（缺任一张都说明结构不完整） */
const CORE_TABLES = [
  'pay_order',
  'refund_order',
  'channel_bill',
  'reconcile_task',
  'reconcile_diff',
  'channel_config',
  'admin_user',
];

export interface SchemaInitResult {
  /** 实际使用的数据库名（可能与传入的大小写不同） */
  database: string;
  /** 请求/配置的原始库名 */
  requestedDatabase: string;
  /** 服务端实际库名（已按现有库或规范化规则校正） */
  actualDatabase: string;
  /** 库名是否被校正过（大小写不一致） */
  nameAdjusted: boolean;
  /** 本次是否新建了库 */
  databaseCreated: boolean;
  /** 本次执行的迁移（含目录名） */
  applied: string[];
  /** 已存在而跳过的迁移数 */
  skipped: number;
  /** 缺失的核心表（为空即结构完整） */
  missingTables: string[];
}

interface DbTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** 附加连接参数（如 connection_limit），连接时忽略 */
  ssl?: boolean;
}

/** 解析 mysql://user:pass@host:port/db?query */
export function parseDatabaseUrl(url: string): DbTarget {
  const u = new URL(url);
  const user = decodeURIComponent(u.username || 'root');
  const password = decodeURIComponent(u.password || '');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL 缺少数据库名');
  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port || 3306),
    user,
    password,
    database,
    ssl: (u.searchParams.get('sslmode') || '') === 'require',
  };
}

/**
 * 迁移目录定位：MIGRATIONS_DIR > cwd/prisma/migrations > 从模块位置向上回溯 5 层
 * （源码运行 src/common/prisma 向上 3 层、构建产物 dist/src/common/prisma 向上 4 层均为项目根）
 */
function resolveMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const cands = [path.join(process.cwd(), 'prisma', 'migrations')];
  for (let up = 0; up <= 5; up++) {
    cands.push(path.join(__dirname, ...Array(up).fill('..'), 'prisma', 'migrations'));
  }
  return cands.find((c) => fs.existsSync(c)) || cands[0];
}

/** 列出迁移目录（按目录名升序，保证 20260920xxx 顺序） */
function listMigrations(dir: string): { name: string; file: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => ({ name, file: path.join(dir, name, 'migration.sql') }))
    .filter((m) => fs.existsSync(m.file));
}

async function tableExists(conn: mysql.Connection, table: string): Promise<boolean> {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [table],
  );
  return (rows as any[]).length > 0;
}

/** 已应用迁移集合：本 runner 记录 + Prisma CLI 记录（后者只读，用于兼容） */
async function loadApplied(conn: mysql.Connection): Promise<Set<string>> {
  const applied = new Set<string>();
  if (!(await tableExists(conn, '_schema_migrations'))) {
    await conn.query(
      'CREATE TABLE IF NOT EXISTS `_schema_migrations` (`name` VARCHAR(190) NOT NULL PRIMARY KEY, `checksum` VARCHAR(64) NULL, `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))',
    );
  }
  const [ours] = await conn.query('SELECT `name` FROM `_schema_migrations`');
  for (const r of ours as any[]) applied.add(r.name);

  if (await tableExists(conn, '_prisma_migrations')) {
    const [theirs] = await conn.query(
      'SELECT `migration_name` FROM `_prisma_migrations` WHERE `finished_at` IS NOT NULL',
    );
    for (const r of theirs as any[]) applied.add(r.migration_name);
  }
  return applied;
}

/**
 * 数据库名规范化：统一小写
 * Linux 下 MySQL 库名区分大小写（lower_case_table_names=0），
 * 填 `Mpay_center` 而库实际是 `mpay_center` 时，连接会被拒（ER_DBACCESS_DENIED_ERROR），
 * 且报错很不直观（Prisma 侧表现为 P1010），故统一按小写处理。
 */
export function normalizeDatabaseName(name: string): string {
  return (name || '').trim().toLowerCase();
}

/** 查找已存在库的实际名称（先精确匹配，再大小写不敏感匹配），不存在返回 null */
async function resolveExistingDatabase(
  conn: mysql.Connection,
  name: string,
): Promise<string | null> {
  const [exact] = await conn.query(
    'SELECT `SCHEMA_NAME` FROM `information_schema`.`SCHEMATA` WHERE `SCHEMA_NAME` = ? LIMIT 1',
    [name],
  );
  if ((exact as any[]).length) return (exact as any[])[0].SCHEMA_NAME;
  const [ci] = await conn.query(
    'SELECT `SCHEMA_NAME` FROM `information_schema`.`SCHEMATA` WHERE LOWER(`SCHEMA_NAME`) = LOWER(?) LIMIT 1',
    [name],
  );
  return (ci as any[]).length ? (ci as any[])[0].SCHEMA_NAME : null;
}

/**
 * 启动时自愈入口
 * @returns 执行结果；库不可达时抛错
 */
export async function ensureSchema(): Promise<SchemaInitResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('未配置 DATABASE_URL');
  const target = parseDatabaseUrl(url);
  const requested = target.database;
  const result: SchemaInitResult = {
    database: requested,
    requestedDatabase: requested,
    actualDatabase: requested,
    nameAdjusted: false,
    databaseCreated: false,
    applied: [],
    skipped: 0,
    missingTables: [],
  };

  const baseCfg: mysql.ConnectionOptions = {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    multipleStatements: true, // 迁移文件为多语句脚本
    charset: 'utf8mb4',
  };

  // ===== 1. 自动建库（不带 database 连接）=====
  const root = await mysql.createConnection(baseCfg);
  try {
    const existing = await resolveExistingDatabase(root, requested);
    if (existing) {
      // 复用现有库的实际名称：大小写不一致时若仍用请求名连接会被拒绝
      result.actualDatabase = existing;
      result.nameAdjusted = existing !== requested;
    } else {
      // 全新库：统一按小写创建，避免后续大小写歧义
      const dbName = normalizeDatabaseName(requested);
      result.actualDatabase = dbName;
      result.nameAdjusted = dbName !== requested;
      await root.query(
        `CREATE DATABASE \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      result.databaseCreated = true;
    }
  } finally {
    await root.end();
  }
  result.database = result.actualDatabase;

  // ===== 2/3. 建表 + 应用增量迁移 =====
  const conn = await mysql.createConnection({ ...baseCfg, database: result.actualDatabase });
  try {
    const applied = await loadApplied(conn);
    for (const m of listMigrations(resolveMigrationsDir())) {
      if (applied.has(m.name)) {
        result.skipped++;
        continue;
      }
      const sql = fs.readFileSync(m.file, 'utf8').trim();
      if (!sql) continue;
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await conn.query(sql);
      await conn.query(
        'INSERT INTO `_schema_migrations` (`name`, `checksum`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `checksum` = VALUES(`checksum`)',
        [m.name, checksum],
      );
      result.applied.push(m.name);
    }

    // ===== 4. 完整性校验 =====
    for (const t of CORE_TABLES) {
      if (!(await tableExists(conn, t))) result.missingTables.push(t);
    }
  } finally {
    await conn.end();
  }

  return result;
}
