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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const logger = new Logger('bootstrap');

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
