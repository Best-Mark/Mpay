import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { OperationLogService } from './log/operation-log.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, OperationLogService],
  exports: [PrismaService, RedisService, OperationLogService],
})
export class CommonModule {}
