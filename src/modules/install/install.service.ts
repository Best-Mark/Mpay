import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import mysql from 'mysql2/promise';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { ensureSchema, parseDatabaseUrl } from '../../common/prisma/schema-init';
import { composeDatabaseUrl, currentDbConfig, loadEnvFile, patchEnvFile } from '../../common/utils/env-file';
import { PasswordUtil } from '../../common/utils/password.util';

/** 安装完成标记文件（存在即视为已安装，安装接口随即关闭） */
const LOCK_FILE = path.join('storage', 'installed.lock');
/** 数据库名规则：MySQL 库名允许的字符 */
const DB_NAME_RE = /^[A-Za-z0-9_$]{1,64}$/;

export interface DbInput {
  host: string;
  port: number;
  user: string;
  password: string;
  /** 库名可自定义，不存在时自动创建 */
  database: string;
}

export interface InstallInput {
  db: DbInput;
  redis: { enabled: boolean; host: string; port: number; password?: string };
  site: { payBaseUrl: string; masterKey?: string; channelMode?: 'sandbox' | 'prod' };
  admin: { username: string; password: string; nickname?: string };
}

/** 已安装判定：安装标记文件存在 */
export function isInstalled(): boolean {
  return fs.existsSync(path.resolve(process.cwd(), LOCK_FILE));
}

/**
 * 有效安装判定（供 main.ts 在启动前使用）
 * 优先认安装标记；没有标记时，若已能连上库且核心表已存在，同样视为已安装
 * —— 这样既有部署升级时不会被误判成「未安装」
 */
export async function checkInstalled(): Promise<boolean> {
  if (isInstalled()) return true;
  const url = composeDatabaseUrl();
  if (!url) return false;
  let conn: mysql.Connection | null = null;
  try {
    const t = parseDatabaseUrl(url);
    conn = await mysql.createConnection({
      host: t.host,
      port: t.port,
      user: t.user,
      password: t.password,
      database: t.database,
      connectTimeout: 3000,
    });
    const [rows] = await conn.query("SHOW TABLES LIKE 'admin_user'");
    return (rows as any[]).length > 0;
  } catch {
    return false;
  } finally {
    if (conn) await conn.end().catch(() => undefined);
  }
}

/** 建立一次短连接探测（不带库名，避免因库不存在而失败） */
async function probe(target: { host: string; port: number; user: string; password: string }) {
  try {
    const conn = await mysql.createConnection({
      host: target.host,
      port: Number(target.port) || 3306,
      user: target.user,
      password: target.password || '',
      connectTimeout: 4000,
    });
    try {
      const [rows] = await conn.query('SELECT VERSION() AS v');
      return { ok: true, serverVersion: String((rows as any[])[0]?.v || '') };
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/**
 * 首次安装向导：
 *   环境自检 → 数据库连通性与权限探测 → 写入 .env → 建库建表 → 创建超管 → 落安装标记
 * 安装完成即关闭本组接口，且需要重启一次进程让 Prisma 使用新的 DATABASE_URL
 */
@Injectable()
export class InstallService {
  private readonly logger = new Logger(InstallService.name);
  /** 一次性重启凭证（仅内存，安装成功后生成） */
  private restartToken: string | null = null;

  /** 安装状态 + 环境自检 */
  async status() {
    loadEnvFile();
    const installed = await checkInstalled();
    const url = composeDatabaseUrl();
    const db = currentDbConfig();
    let dbReachable: { ok: boolean; message?: string; serverVersion?: string } | null = null;
    if (url && db.host) {
      // 从完整连接串取密码（分项配置里也能得到）
      let password = process.env.DB_PASSWORD || '';
      try {
        password = parseDatabaseUrl(url).password || password;
      } catch {
        /* 忽略：回退到 DB_PASSWORD */
      }
      const r = await probe({ host: db.host, port: db.port, user: db.user, password });
      dbReachable = r.ok ? { ok: true, serverVersion: r.serverVersion } : { ok: false, message: r.message };
    }

    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const storageDir = path.resolve(process.cwd(), 'storage');
    const envPath = path.resolve(process.cwd(), '.env');
    // 逐级向上找到「存在的祖先目录」再判可写（storage 尚未创建时也能正确判定）
    const writable = (p: string): boolean => {
      let cur = path.resolve(p);
      for (let i = 0; i < 6; i++) {
        if (fs.existsSync(cur)) {
          try {
            fs.accessSync(cur, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        }
        const parent = path.dirname(cur);
        if (parent === cur) return false;
        cur = parent;
      }
      return false;
    };

    return {
      installed,
      envFileExists: fs.existsSync(envPath),
      envWritable: writable(envPath),
      storageWritable: writable(path.join(storageDir, '.write-test')),
      dbConfigured: !!url,
      dbReachable,
      db: { ...db, password: undefined },
      site: {
        payBaseUrl: process.env.PAY_BASE_URL || '',
        channelMode: process.env.DEFAULT_CHANNEL_MODE || 'sandbox',
        masterKeySet: !!process.env.MASTER_KEY,
        redisEnabled: (process.env.REDIS_ENABLED || 'false') === 'true',
        redisHost: process.env.REDIS_HOST || '127.0.0.1',
        redisPort: Number(process.env.REDIS_PORT || 6379),
      },
      checks: [
        {
          name: 'Node 版本',
          ok: nodeMajor >= 20,
          detail: `${process.versions.node}${nodeMajor >= 20 ? '' : '（需要 >= 20）'}`,
        },
        { name: '配置文件可写', ok: writable(envPath), detail: fs.existsSync(envPath) ? '.env 可更新' : '将创建 .env' },
        { name: '存储目录可写', ok: writable(path.join(storageDir, '.write-test')), detail: storageDir },
        {
          name: '数据库连通性',
          ok: !url ? null : !!dbReachable?.ok,
          detail: !url ? '未配置（安装向导中填写）' : dbReachable?.ok ? `已连通 ${dbReachable.serverVersion || ''}` : dbReachable?.message || '连接失败',
        },
      ],
    };
  }

  /** 测试数据库连接，并探测建库权限与目标库是否已存在 */
  async testDb(input: DbInput) {
    this.assertDbInput(input);
    const r = await probe(input);
    if (!r.ok) return { ok: false, message: r.message, databaseExists: false, canCreateDatabase: false };

    const conn = await mysql.createConnection({
      host: input.host,
      port: Number(input.port) || 3306,
      user: input.user,
      password: input.password || '',
      connectTimeout: 4000,
    });
    try {
      const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [input.database]);
      const databaseExists = (dbs as any[]).length > 0;
      // 建库权限：优先看授权串，无法判断时按可建库处理（后续真实建库会给出明确错误）
      let canCreateDatabase = true;
      try {
        const [grants] = await conn.query('SHOW GRANTS FOR CURRENT_USER()');
        const text = (grants as any[]).map((g) => Object.values(g)[0]).join(' ');
        if (text) {
          canCreateDatabase = /ALL PRIVILEGES|CREATE\s|CREATE,|SUPER/i.test(text);
        }
      } catch {
        /* 忽略：保留默认 true */
      }
      return { ok: true, databaseExists, canCreateDatabase, serverVersion: r.serverVersion };
    } catch (e: any) {
      return { ok: false, message: e?.message || String(e), databaseExists: false, canCreateDatabase: false };
    } finally {
      await conn.end();
    }
  }

  /**
   * 执行安装：写 .env → 建库建表 → 创建超管 → 落安装标记
   * @returns restartToken：用于调用 /api/install/restart 触发一次重启（PM2/systemd/docker 会自动拉起）
   */
  async apply(input: InstallInput) {
    if (isInstalled()) throw new BizException(ErrorCode.ALREADY_INSTALLED, '系统已安装，如需重装请删除 storage/installed.lock');
    this.assertDbInput(input?.db);
    if (!input?.admin?.username || input.admin.username.length < 3) {
      throw new BizException(ErrorCode.PARAM_ERROR, '管理员用户名至少 3 位');
    }
    if (!input?.admin?.password || input.admin.password.length < 8) {
      throw new BizException(ErrorCode.PARAM_ERROR, '管理员密码至少 8 位');
    }

    const masterKey = (input?.site?.masterKey || '').trim() || crypto.randomBytes(32).toString('hex');

    // 1) 写入 .env（数据库名即用户自定义的名字）
    const patch: Record<string, string> = {
      DB_HOST: input.db.host,
      DB_PORT: String(Number(input.db.port) || 3306),
      DB_USER: input.db.user,
      DB_PASSWORD: input.db.password || '',
      DB_NAME: input.db.database,
      REDIS_ENABLED: input?.redis?.enabled ? 'true' : 'false',
      REDIS_HOST: input?.redis?.host || '127.0.0.1',
      REDIS_PORT: String(Number(input?.redis?.port) || 6379),
      MASTER_KEY: masterKey,
      NOTIFY_SIGN_SALT: process.env.NOTIFY_SIGN_SALT || crypto.randomBytes(16).toString('hex'),
      PAY_BASE_URL: (input?.site?.payBaseUrl || '').replace(/\/$/, ''),
      DEFAULT_CHANNEL_MODE: input?.site?.channelMode === 'prod' ? 'prod' : 'sandbox',
      BILL_STORE_DIR: process.env.BILL_STORE_DIR || './storage/bills',
      SCHEMA_AUTO_INIT: 'true',
    };
    if (input?.redis?.password) patch.REDIS_PASSWORD = input.redis.password;
    // 旧配置里的整串优先级高于分项，安装时必须注释掉，否则自定义库名不生效
    (patch as Record<string, string | null>).DATABASE_URL = null;
    patchEnvFile(patch);
    process.env.DATABASE_URL = composeDatabaseUrl()!;
    this.logger.log(`配置已写入 .env，目标库 ${input.db.database}`);

    // 2) 预建存储目录（账单文件等）→ 建库 + 建表（自动应用全部迁移）
    fs.mkdirSync(path.resolve(process.cwd(), patch.BILL_STORE_DIR), { recursive: true });
    const schema = await ensureSchema();
    if (schema.missingTables.length) {
      throw new BizException(ErrorCode.SYSTEM_ERROR, `建表不完整，缺少: ${schema.missingTables.join(', ')}`);
    }

    // 3) 创建超级管理员（此处用原生驱动：Prisma 客户端仍持有安装前的连接串）
    const target = parseDatabaseUrl(process.env.DATABASE_URL);
    const conn = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      database: target.database,
      connectTimeout: 5000,
    });
    try {
      const [exist] = await conn.query('SELECT id FROM `admin_user` WHERE `username` = ? LIMIT 1', [
        input.admin.username,
      ]);
      if ((exist as any[]).length === 0) {
        await conn.query(
          'INSERT INTO `admin_user` (`username`, `password_hash`, `nickname`, `role`, `is_active`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, 1, NOW(3), NOW(3))',
          [
            input.admin.username,
            PasswordUtil.hash(input.admin.password),
            input.admin.nickname || '超级管理员',
            'SUPER',
          ],
        );
      }
    } finally {
      await conn.end();
    }

    // 4) 落安装标记：此后安装接口关闭
    const lockPath = path.resolve(process.cwd(), LOCK_FILE);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        { installedAt: new Date().toISOString(), database: input.db.database, appliedMigrations: schema.applied },
        null,
        2,
      ),
      'utf8',
    );

    this.restartToken = crypto.randomBytes(16).toString('hex');
    this.logger.log(`安装完成：库 ${input.db.database}，管理员 ${input.admin.username}；等待重启以加载新配置`);
    return {
      installed: true,
      database: input.db.database,
      databaseCreated: schema.databaseCreated,
      appliedMigrations: schema.applied,
      restartToken: this.restartToken,
    };
  }

  /** 安装后重启进程（需一次性 token；无守护进程时需人工启动） */
  restart(token: string) {
    if (!this.restartToken || token !== this.restartToken) {
      throw new BizException(ErrorCode.FORBIDDEN, '无效的重启凭证');
    }
    this.restartToken = null;
    setTimeout(() => process.exit(0), 800);
    return { restarting: true };
  }

  private assertDbInput(db?: DbInput) {
    if (!db?.host) throw new BizException(ErrorCode.PARAM_ERROR, '请填写数据库地址');
    if (!db?.user) throw new BizException(ErrorCode.PARAM_ERROR, '请填写数据库用户名');
    if (!db?.database) throw new BizException(ErrorCode.PARAM_ERROR, '请填写数据库名');
    if (!DB_NAME_RE.test(db.database)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '数据库名只能包含字母、数字、下划线与 $，长度 1-64');
    }
  }
}
