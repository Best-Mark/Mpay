import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as crypto from 'crypto';
import { AppModule } from './app.module';
import { PrismaService } from './common/prisma/prisma.service';
import { AdminAuthService } from './modules/admin/admin-auth.service';
import { TraceContext } from './common/utils/trace-context';
import { ChannelService } from './modules/channel/channel.service';
import { ensureSchema } from './common/prisma/schema-init';

async function bootstrap() {
  const logger = new Logger('bootstrap');

  // ===== 数据库结构自愈（必须在 Nest 容器初始化前：Prisma 连接时库必须已存在）=====
  // 建库 → 建表 → 应用新版本带来的增量迁移；SCHEMA_AUTO_INIT=false 可关闭
  if ((process.env.SCHEMA_AUTO_INIT ?? 'true') !== 'false') {
    try {
      const r = await ensureSchema();
      if (r.databaseCreated) logger.log(`数据库 ${r.database} 不存在，已自动创建`);
      if (r.applied.length) logger.log(`已应用数据库迁移 ${r.applied.length} 个: ${r.applied.join(', ')}`);
      if (r.missingTables.length) {
        logger.error(`数据库结构不完整，缺少表: ${r.missingTables.join(', ')}（检查 prisma/migrations 是否随包部署）`);
      }
    } catch (e: any) {
      logger.error(`数据库结构自愈失败（不阻断启动，接口将不可用）: ${e.message}`);
    }
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // ===== 安全头 =====
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  // ===== 原始报文捕获 =====
  // 签名校验与渠道回调都必须基于「未经解析的原始 body」，故在此处留存
  app.use(require('express').json({
    limit: '2mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf ? buf.toString('utf8') : '';
    },
  }));
  app.use(require('express').urlencoded({
    extended: true,
    limit: '2mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf ? buf.toString('utf8') : '';
    },
  }));

  // ===== 链路追踪中间件 =====
  app.use((req: any, _res: any, next: any) => {
    const traceId = (req.headers['x-trace-id'] as string) || crypto.randomUUID().replace(/-/g, '');
    req.traceId = traceId;
    TraceContext.run({ traceId }, () => next());
  });

  // ===== 限流（防刷 / 防重放补充）=====
  if ((process.env.RATE_LIMIT_ENABLED ?? 'true') !== 'false') {
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: { code: 1004, message: '请求过于频繁' },
    });
    app.use(limiter);
  }

  app.enableCors({
    origin: (process.env.CORS_ORIGINS || '*').split(','),
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // ===== Swagger 接口文档 =====
  const doc = new DocumentBuilder()
    .setTitle('统一支付中心 API')
    .setDescription('统一支付中心：下单 / 查询 / 退款 / 异步通知 / 对账。所有开放接口使用 AppKey + HMAC-SHA256 签名鉴权。')
    .setVersion('1.0')
    .addTag('开放接口-支付')
    .addTag('开放接口-退款')
    .addTag('渠道回调')
    .addTag('管理后台-对账')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  // ===== 启动自检与种子数据 =====
  const prisma = app.get(PrismaService);
  const dbOk = await prisma.ping().catch(() => false);
  if (!dbOk) {
    logger.error('数据库连接失败，请检查 DATABASE_URL 配置');
  } else {
    logger.log('数据库连接正常');
    try {
      await app.get(AdminAuthService).ensureSuperAdmin();
    } catch (e: any) {
      logger.warn(`初始化管理员失败（表可能尚未创建）: ${e.message}`);
    }
  }

  // 预热渠道配置缓存失败不阻断启动
  try {
    await app.get(ChannelService).getAdapter('mock');
  } catch {
    /* ignore */
  }

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`统一支付中心已启动: http://localhost:${port}  接口文档: http://localhost:${port}/docs`);
}

bootstrap();
