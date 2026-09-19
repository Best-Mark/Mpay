import { Body, Controller, Get, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UploadService } from './upload.service';
import { AdminAuthGuard, currentAdmin } from '../admin/admin-auth.guard';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

/**
 * 图片上传（后台使用）
 * 统一走 multipart/form-data，字段名为 file；上传即压缩转 WebP，落 storage/uploads
 */
@ApiTags('管理后台-文件上传')
@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('upload')
  @ApiOperation({ summary: '上传图片（自动压缩转 WebP）' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @UploadedFile() file: any,
    @Body() body: { scene?: string },
    @Req() req: Request,
  ) {
    if (!file) throw new BizException(ErrorCode.PARAM_ERROR, '未收到文件，请使用字段名 file');
    return this.uploadService.save(file, body?.scene || 'image', currentAdmin(req).username);
  }

  @Get('uploads')
  @ApiOperation({ summary: '最近上传记录' })
  async list(@Query('scene') scene?: string, @Query('limit') limit?: string) {
    return this.uploadService.list(scene, Number(limit || 30));
  }
}
