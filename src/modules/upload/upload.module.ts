import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  // 上传接口挂在后台鉴权下，需要 AdminAuthGuard 依赖的 AdminAuthService
  imports: [AdminModule],
  providers: [UploadService],
  controllers: [UploadController],
  exports: [UploadService],
})
export class UploadModule {}
