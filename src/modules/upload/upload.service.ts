import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BizException } from '../../common/exceptions/biz.exception';
import { ErrorCode } from '../../common/constants/error-codes';

/**
 * 上传处理规格
 * 统一转 WebP：同等观感下体积约为 JPEG 的 60~70%，PNG 的 30% 左右
 */
export interface UploadProfile {
  /** 最长边限制（超过等比缩放，不放大） */
  maxEdge: number;
  /** WebP 质量 1-100 */
  quality: number;
  /** 固定尺寸（头像等），按 cover 裁切 */
  fit?: { width: number; height: number };
}

export const UPLOAD_PROFILES: Record<string, UploadProfile> = {
  /** 站点 / 商户 Logo：体积小、显示尺寸小 */
  logo: { maxEdge: 480, quality: 82 },
  /** 头像：正方形裁切 */
  avatar: { maxEdge: 256, quality: 84, fit: { width: 256, height: 256 } },
  /** 通用图片：长图切片也要压到 1920 以内 */
  image: { maxEdge: 1920, quality: 82 },
  /** 原图直传（不推荐，仅用于必须保真的场景） */
  raw: { maxEdge: 4096, quality: 90 },
};

/** 允许的图片类型（MIME → 扩展名） */
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export interface UploadedFile {
  url: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  originalName: string;
}

/**
 * 图片上传与压缩转换
 *
 * 处理策略：
 *   1) 类型白名单校验（拒绝 svg/html：可携带脚本，属 XSS 载体）
 *   2) 等比缩到规格内（只缩不放，避免小图被拉伸变糊）
 *   3) 统一转 WebP（GIF 例外：sharp 处理动图会丢帧，故动图原样保存）
 *   4) sharp 不可用时降级为「原图落盘」并告警，绝不因依赖缺失让上传整体不可用
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get rootDir(): string {
    return path.resolve(process.cwd(), process.env.UPLOAD_DIR || './storage/uploads');
  }

  async save(
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    scene = 'image',
    uploadedBy?: string,
  ): Promise<UploadedFile> {
    if (!file?.buffer?.length) throw new BizException(ErrorCode.PARAM_ERROR, '未收到文件');
    const ext = ALLOWED_MIME[file.mimetype];
    if (!ext) throw new BizException(ErrorCode.UPLOAD_TYPE_NOT_ALLOWED, `不支持的文件类型：${file.mimetype}`);
    if ((file.size || file.buffer.length) > MAX_SIZE) {
      throw new BizException(ErrorCode.UPLOAD_TOO_LARGE, `文件不能超过 ${MAX_SIZE / 1024 / 1024}MB`);
    }
    const profile = UPLOAD_PROFILES[scene] || UPLOAD_PROFILES.image;

    let out: Buffer = file.buffer;
    let mime = 'image/webp';
    let width: number | undefined;
    let height: number | undefined;

    // GIF 保持原样（动图帧信息不能被压掉）
    if (file.mimetype === 'image/gif') {
      out = file.buffer;
      mime = 'image/gif';
    } else {
      const processed = await this.compress(file.buffer, profile);
      out = processed.data;
      width = processed.width;
      height = processed.height;
      mime = processed.mime;
    }

    const dir = path.join(this.rootDir, this.monthDir());
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${mime === 'image/webp' ? 'webp' : ext}`;
    const abs = path.join(dir, filename);
    fs.writeFileSync(abs, out);

    const url = `/uploads/${this.monthDir()}/${filename}`;
    try {
      await this.prisma.uploadFile.create({
        data: {
          scene,
          originalName: (file.originalname || '').slice(0, 255),
          url,
          mime,
          size: out.length,
          width,
          height,
          uploadedBy,
        },
      });
    } catch (e: any) {
      // 记录失败不影响上传结果
      this.logger.warn(`上传记录写入失败: ${e.message}`);
    }

    return { url, mime, size: out.length, width, height, originalName: file.originalname };
  }

  /** 压缩转换：失败时降级返回原图 */
  private async compress(
    input: Buffer,
    profile: UploadProfile,
  ): Promise<{ data: Buffer; mime: string; width?: number; height?: number }> {
    try {
      // sharp 是原生依赖，安装失败不能被整个上传功能拖垮，故动态引入
      const sharp = require('sharp');
      let pipeline = sharp(input, { failOn: 'none' }).rotate();
      if (profile.fit) {
        pipeline = pipeline.resize(profile.fit.width, profile.fit.height, { fit: 'cover', withoutEnlargement: true });
      } else {
        pipeline = pipeline.resize(profile.maxEdge, profile.maxEdge, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
      const data = await pipeline.webp({ quality: profile.quality }).toBuffer();
      const meta = await sharp(data).metadata();
      return { data, mime: 'image/webp', width: meta.width, height: meta.height };
    } catch (e: any) {
      this.logger.error(`图片压缩失败，已按原图保存: ${e.message}`);
      return { data: input, mime: 'application/octet-stream' };
    }
  }

  private monthDir(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** 列出最近上传（后台选择已上传图片时用） */
  async list(scene?: string, limit = 30) {
    const rows = await this.prisma.uploadFile.findMany({
      where: scene ? { scene } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, limit),
    });
    return rows.map((r) => ({
      id: Number(r.id),
      scene: r.scene,
      url: r.url,
      mime: r.mime,
      size: r.size,
      width: r.width,
      height: r.height,
      createdAt: r.createdAt,
    }));
  }
}
