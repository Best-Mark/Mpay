import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis 服务（可选依赖）
 * - REDIS_ENABLED=true 时使用真实 Redis
 * - 否则降级为进程内内存实现（仅适用于单机/开发调试）
 * 生产环境（多实例部署）必须开启 Redis：幂等去重、nonce 防重放、分布式锁都依赖它
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly memory = new Map<string, { value: string; expireAt: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    const enabled = process.env.REDIS_ENABLED === 'true';
    if (!enabled) {
      this.logger.warn('Redis 未启用，使用进程内内存降级实现（仅适合单机/本地调试）');
      return;
    }
    this.client = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB || 0),
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    this.client.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  get isReal(): boolean {
    return !!this.client;
  }

  async get(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expireAt && hit.expireAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.client) {
      if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
      else await this.client.set(key, value);
      return;
    }
    this.memory.set(key, { value, expireAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0 });
  }

  async del(key: string): Promise<void> {
    if (this.client) {
      await this.client.del(key);
      return;
    }
    this.memory.delete(key);
  }

  /** 原子 set-if-not-exists，返回是否设置成功（用于幂等/防重放/锁） */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.client) {
      const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    }
    const cur = await this.get(key);
    if (cur !== null) return false;
    this.memory.set(key, { value, expireAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (this.client) {
      const v = await this.client.incr(key);
      if (ttlSeconds && v === 1) await this.client.expire(key, ttlSeconds);
      return v;
    }
    const cur = Number((await this.get(key)) || 0) + 1;
    await this.set(key, String(cur), ttlSeconds);
    return cur;
  }

  /** 分布式锁：成功返回锁标识，失败返回 null */
  async tryLock(key: string, ttlSeconds = 30): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const ok = await this.setNx(`lock:${key}`, token, ttlSeconds);
    return ok ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    if (this.client) {
      const cur = await this.client.get(`lock:${key}`);
      if (cur === token) await this.client.del(`lock:${key}`);
      return;
    }
    const cur = await this.get(`lock:${key}`);
    if (cur === token) this.memory.delete(`lock:${key}`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.client) this.client.disconnect();
  }
}
