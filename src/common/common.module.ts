import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { OperationLogService } from './log/operation-log.service';
import { SystemConfigService } from './config/system-config.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, OperationLogService, SystemConfigService],
  exports: [PrismaService, RedisService, OperationLogService, SystemConfigService],
})
export class CommonModule {}
