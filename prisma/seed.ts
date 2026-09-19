import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `pbkdf2$${salt}$${hash}`;
}

async function main() {
  console.log('开始初始化种子数据...');

  // 1. 超级管理员
  const exists = await prisma.adminUser.findUnique({ where: { username: 'admin' } });
  if (!exists) {
    await prisma.adminUser.create({
      data: {
        username: 'admin',
        passwordHash: hashPassword('Pay@admin123'),
        role: 'SUPER',
        nickname: '超级管理员',
      },
    });
    console.log('  已创建超级管理员：admin / Pay@admin123（请登录后立即修改密码）');
  }

  // 2. 模拟渠道配置（sandbox）
  const mockCfg = await prisma.channelConfig.findFirst({ where: { channel: 'mock' } });
  if (!mockCfg) {
    await prisma.channelConfig.create({
      data: {
        channel: 'mock',
        name: '模拟渠道（本地联调）',
        mchId: 'MOCK_MCH_001',
        isSandbox: true,
        enabled: true,
        priority: 0,
        notifyUrl: '/api/v1/notify/mock/pay',
      },
    });
    console.log('  已创建模拟渠道配置');
  }

  // 3. 微信/支付宝渠道占位（未配置密钥，默认停用，需在后台补全后启用）
  for (const [channel, name] of [
    ['wechat', '微信支付'],
    ['alipay', '支付宝'],
  ] as const) {
    const exist = await prisma.channelConfig.findFirst({ where: { channel } });
    if (!exist) {
      await prisma.channelConfig.create({
        data: {
          channel,
          name: `${name}（待配置密钥）`,
          mchId: `TODO_${channel.toUpperCase()}_MCHID`,
          isSandbox: false,
          enabled: false,
          priority: 0,
          notifyUrl: `/api/v1/notify/${channel}/pay`,
        },
      });
      console.log(`  已创建 ${name} 渠道占位配置（默认停用，需补全密钥后启用）`);
    }
  }

  console.log('种子数据初始化完成');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
