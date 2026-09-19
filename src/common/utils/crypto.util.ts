import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * 加解密 / 签名 工具
 * - 敏感配置（商户私钥、AppSecret）AES-256-GCM 加密后落库
 * - 对外接口签名：HMAC-SHA256
 * - 渠道签名（微信 V3 / 支付宝 RSA2）在渠道模块内实现
 */
export class CryptoUtil {
  private static masterKey: Buffer | null = null;

  /**
   * 主密钥：32 字节。取 MASTER_KEY 的 sha256，保证长度一定是 32 字节
   * 生产环境务必通过环境变量注入，且不可写入代码库
   */
  private static getMasterKey(): Buffer {
    if (!CryptoUtil.masterKey) {
      const raw = process.env.MASTER_KEY || 'insecure_default_master_key_change_me';
      CryptoUtil.masterKey = crypto.createHash('sha256').update(raw).digest();
    }
    return CryptoUtil.masterKey;
  }

  /** AES-256-GCM 加密，返回 base64(iv):base64(tag):base64(cipher) */
  static encrypt(plain: string): string {
    if (plain === null || plain === undefined || plain === '') return plain;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', CryptoUtil.getMasterKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  /** AES-256-GCM 解密，失败返回原值（兼容历史明文数据） */
  static decrypt(payload: string): string {
    if (!payload) return payload;
    const parts = payload.split(':');
    if (parts.length !== 3) return payload; // 非加密格式，原样返回
    try {
      const iv = Buffer.from(parts[0], 'base64');
      const tag = Buffer.from(parts[1], 'base64');
      const enc = Buffer.from(parts[2], 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', CryptoUtil.getMasterKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch {
      // 主密钥变更或数据损坏：返回原文，由上层决定是否敏感报错
      return payload;
    }
  }

  /** HMAC-SHA256 签名 */
  static hmacSha256(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex');
  }

  /** MD5（部分渠道/老接口需要） */
  static md5(data: string): string {
    return crypto.createHash('md5').update(data, 'utf8').digest('hex');
  }

  static sha256(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
  }

  /**
   * 构建待签名串：
   * 1. 剔除 sign / sign_type / 空值字段
   * 2. 按 key 的 ASCII 升序排序
   * 3. key=value 用 & 连接
   */
  static buildSignContent(params: Record<string, any>): string {
    const keys = Object.keys(params)
      .filter((k) => {
        const v = params[k];
        return k !== 'sign' && k !== 'sign_type' && v !== undefined && v !== null && v !== '';
      })
      .sort();
    return keys.map((k) => `${k}=${stringify(params[k])}`).join('&');
  }

  /** 安全比较，防时序攻击 */
  static safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(String(a || ''));
    const bb = Buffer.from(String(b || ''));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  }

  /** 随机字符串 */
  static randomString(len = 32): string {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
  }

  /** RSA-SHA256 签名（支付宝 RSA2、微信 V3 均使用） */
  static rsaSign(content: string, privateKeyPem: string): string {
    return crypto
      .createSign('RSA-SHA256')
      .update(content, 'utf8')
      .sign(privateKeyPem, 'base64');
  }

  /** RSA-SHA256 验签 */
  static rsaVerify(content: string, signature: string, publicKeyPem: string): boolean {
    try {
      return crypto
        .createVerify('RSA-SHA256')
        .update(content, 'utf8')
        .verify(publicKeyPem, signature, 'base64');
    } catch {
      return false;
    }
  }

  /** RSA-OAEP 加密（微信 V3 敏感信息加密：使用平台证书公钥） */
  static rsaEncryptOAEP(text: string, publicKeyPem: string): string {
    return crypto
      .publicEncrypt(
        {
          key: publicKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha1',
        },
        Buffer.from(text, 'utf8'),
      )
      .toString('base64');
  }

  /** AES-256-GCM 解密微信 V3 通知资源 */
  static aesGcmDecrypt(apiV3Key: string, nonce: string, associatedData: string, ciphertext: string): string {
    const key = Buffer.from(apiV3Key, 'utf8');
    const enc = Buffer.from(ciphertext, 'base64');
    const authTag = enc.subarray(enc.length - 16);
    const data = enc.subarray(0, enc.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(associatedData || '', 'utf8'));
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** 读取 PEM 文件（私钥/证书/公钥） */
  static readPem(path: string): string {
    return fs.readFileSync(path, 'utf8');
  }
}

function stringify(v: any): string {
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
