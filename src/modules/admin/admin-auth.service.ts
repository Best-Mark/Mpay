import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OperationLogService } from '../../common/log/operation-log.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';
import { AdminRole } from '../../common/constants/enums';
import { PasswordUtil } from '../../common/utils/password.util';

const JWT_SECRET = () => process.env.MASTER_KEY || 'pay-center-jwt-secret';
const JWT_TTL_SECONDS = 12 * 3600;

export interface AdminPrincipal {
  sub: string;
  username: string;
  role: string;
  nickname?: string;
}

/**
 * 管理后台鉴权
 * JWT 使用内置的 HMAC-SHA256 实现（HS256），避免引入额外依赖
 * 密码使用 PBKDF2（10000 次迭代 + 随机盐）哈希，绝不明文存储
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly opLog: OperationLogService,
  ) {}

  // ==================== 密码 ====================

  // 密码哈希与安装向导共用同一算法（pbkdf2$盐$哈希）
  private hashPassword(password: string): string {
    return PasswordUtil.hash(password);
  }

  private verifyPassword(password: string, stored: string): boolean {
    return PasswordUtil.verify(password, stored);
  }

  // ==================== JWT ====================

  private b64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  signToken(p: AdminPrincipal): string {
    const header = this.b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const body = this.b64url(JSON.stringify({ ...p, iat: now, exp: now + JWT_TTL_SECONDS }));
    const sig = this.b64url(crypto.createHmac('sha256', JWT_SECRET()).update(`${header}.${body}`).digest());
    return `${header}.${body}.${sig}`;
  }

  verifyToken(token: string): AdminPrincipal | null {
    try {
      const [header, body, sig] = token.split('.');
      if (!header || !body || !sig) return null;
      const expected = this.b64url(crypto.createHmac('sha256', JWT_SECRET()).update(`${header}.${body}`).digest());
      if (expected !== sig) return null;
      const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
      if (payload.exp && payload.exp * 1000 < Date.now()) return null;
      return { sub: payload.sub, username: payload.username, role: payload.role, nickname: payload.nickname };
    } catch {
      return null;
    }
  }

  // ==================== 登录 ====================

  async login(username: string, password: string, ip?: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!user || !user.isActive || !this.verifyPassword(password, user.passwordHash)) {
      await this.opLog.write({
        operator: username,
        operatorType: 'ADMIN',
        module: 'admin',
        action: 'login',
        detail: '登录失败：用户名或密码错误',
        ip,
        result: 'FAILED',
      });
      throw new BizException(ErrorCode.TOKEN_INVALID, '用户名或密码错误');
    }

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    });
    await this.opLog.write({
      operator: username,
      operatorType: 'ADMIN',
      module: 'admin',
      action: 'login',
      detail: '登录成功',
      ip,
    });

    const principal: AdminPrincipal = {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      nickname: user.nickname || user.username,
    };
    return { token: this.signToken(principal), expiresIn: JWT_TTL_SECONDS, user: principal };
  }

  async me(principal: AdminPrincipal) {
    const user = await this.prisma.adminUser.findUnique({ where: { username: principal.username } });
    if (!user) throw new BizException(ErrorCode.TOKEN_INVALID);
    return {
      id: Number(user.id),
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      lastLoginAt: user.lastLoginAt,
    };
  }

  async changePassword(username: string, oldPassword: string, newPassword: string, ip?: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!user || !this.verifyPassword(oldPassword, user.passwordHash)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '原密码不正确');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new BizException(ErrorCode.PARAM_ERROR, '新密码至少 8 位');
    }
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: this.hashPassword(newPassword) },
    });
    await this.opLog.write({
      operator: username,
      operatorType: 'ADMIN',
      module: 'admin',
      action: 'change_password',
      detail: '修改登录密码',
      ip,
    });
    return { success: true };
  }

  // ==================== 账号管理 ====================

  async listUsers() {
    const rows = await this.prisma.adminUser.findMany({ orderBy: { id: 'asc' } });
    return rows.map((r) => ({
      id: Number(r.id),
      username: r.username,
      nickname: r.nickname,
      role: r.role,
      email: r.email,
      isActive: r.isActive,
      lastLoginAt: r.lastLoginAt,
      createdAt: r.createdAt,
    }));
  }

  async createUser(input: {
    username: string;
    password: string;
    nickname?: string;
    role: AdminRole;
    email?: string;
    operator: string;
    ip?: string;
  }) {
    const exist = await this.prisma.adminUser.findUnique({ where: { username: input.username } });
    if (exist) throw new BizException(ErrorCode.PARAM_ERROR, '用户名已存在');
    if (!input.password || input.password.length < 8) {
      throw new BizException(ErrorCode.PARAM_ERROR, '密码至少 8 位');
    }
    await this.prisma.adminUser.create({
      data: {
        username: input.username,
        passwordHash: this.hashPassword(input.password),
        nickname: input.nickname,
        role: input.role,
        email: input.email,
      },
    });
    await this.opLog.write({
      operator: input.operator,
      operatorType: 'ADMIN',
      module: 'admin',
      action: 'create_user',
      targetId: input.username,
      detail: `创建后台账号，角色 ${input.role}`,
      ip: input.ip,
    });
    return { success: true };
  }

  async updateUser(
    id: number,
    input: { nickname?: string; role?: AdminRole; email?: string; isActive?: boolean; password?: string },
    operator: string,
    ip?: string,
  ) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: BigInt(id) } });
    if (!user) throw new BizException(ErrorCode.DATA_NOT_FOUND, '账号不存在');
    if (user.role === AdminRole.SUPER && input.isActive === false) {
      throw new BizException(ErrorCode.FORBIDDEN, '不能停用超级管理员');
    }
    await this.prisma.adminUser.update({
      where: { id: BigInt(id) },
      data: {
        nickname: input.nickname,
        role: input.role,
        email: input.email,
        isActive: input.isActive,
        passwordHash: input.password ? this.hashPassword(input.password) : undefined,
      },
    });
    await this.opLog.write({
      operator,
      operatorType: 'ADMIN',
      module: 'admin',
      action: 'update_user',
      targetId: user.username,
      detail: '修改后台账号',
      payload: { ...input, password: input.password ? '***' : undefined },
      ip,
    });
    return { success: true };
  }

  /** 初始化超级管理员（种子数据用） */
  async ensureSuperAdmin(username = 'admin', password = 'Pay@admin123'): Promise<void> {
    const exist = await this.prisma.adminUser.findUnique({ where: { username } });
    if (exist) return;
    await this.prisma.adminUser.create({
      data: { username, passwordHash: this.hashPassword(password), role: AdminRole.SUPER, nickname: '超级管理员' },
    });
    this.logger.warn(`已初始化超级管理员：${username} / ${password}，请首次登录后立即修改密码`);
  }
}
