import * as crypto from 'crypto';

/**
 * 后台账号密码哈希：PBKDF2(sha512, 10000 次迭代, 16 字节随机盐)
 * 存储格式：pbkdf2$<salt>$<hash>，绝不明文落库
 */
export const PasswordUtil = {
  hash(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `pbkdf2$${salt}$${hash}`;
  },

  verify(password: string, stored: string): boolean {
    if (!stored?.startsWith('pbkdf2$')) return false;
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    const calc = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'));
    } catch {
      return false;
    }
  },
};
