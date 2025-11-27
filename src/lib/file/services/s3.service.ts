import { ENVEnum } from '@/common/enum/env.enum';
import { AppError } from '@/common/error/handle-error.app';
import { PrismaService } from '@/lib/prisma/prisma.service';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileType } from '@prisma';
import * as fs from 'fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';

@Injectable()
export class S3Service {
  private s3: S3Client;
  private AWS_S3_BUCKET_NAME: string;
  private AWS_REGION: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.AWS_REGION = this.configService.getOrThrow(ENVEnum.AWS_REGION);
    this.AWS_S3_BUCKET_NAME = this.configService.getOrThrow(
      ENVEnum.AWS_S3_BUCKET_NAME,
    );

    this.s3 = new S3Client({
      region: this.AWS_REGION,
      credentials: {
        accessKeyId: this.configService.getOrThrow(ENVEnum.AWS_ACCESS_KEY_ID),
        secretAccessKey: this.configService.getOrThrow(
          ENVEnum.AWS_SECRET_ACCESS_KEY,
        ),
      },
    });
  }

  private async uploadBuffer(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.AWS_S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    return `https://${this.AWS_S3_BUCKET_NAME}.s3.${this.AWS_REGION}.amazonaws.com/${key}`;
  }

  private async deleteObject(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.AWS_S3_BUCKET_NAME,
        Key: key,
      }),
    );
  }

  async uploadFile(file: Express.Multer.File) {
    const fileExt = file.originalname.split('.').pop();
    const folder = this.getFolderByMimeType(file.mimetype);
    const uniqueFileName = `${uuid()}.${fileExt}`;
    const s3Key = `${folder}/${uniqueFileName}`;

    // Upload to S3
    const fileUrl = await this.uploadBuffer(s3Key, file.buffer, file.mimetype);

    // Save record in database
    const fileRecord = await this.prisma.client.fileInstance.create({
      data: {
        filename: uniqueFileName,
        originalFilename: file.originalname,
        path: s3Key,
        url: fileUrl,
        fileType: this.getFileType(file.mimetype),
        mimeType: file.mimetype,
        size: file.size,
      },
    });

    return fileRecord;
  }

  async deleteFile(id: string) {
    const file = await this.prisma.client.fileInstance.findUnique({
      where: { id },
    });

    if (!file) {
      throw new AppError(404, 'File not found');
    }

    await this.deleteObject(file.path);

    await this.prisma.client.fileInstance.delete({
      where: { id },
    });
  }

  async uploadFileByPath(filePath: string, originalName?: string) {
    if (!fs.existsSync(filePath)) {
      throw new AppError(404, `File not found at path: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileExt = path.extname(originalName || filePath).slice(1); // remove dot
    const mimeType = this.getMimeTypeFromExtension(fileExt);
    const folder = this.getFolderByMimeType(mimeType);
    const uniqueFileName = `${uuid()}.${fileExt}`;
    const s3Key = `${folder}/${uniqueFileName}`;

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: this.AWS_S3_BUCKET_NAME,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await this.s3.send(command);

    // Construct file URL
    const fileUrl = `https://${this.AWS_S3_BUCKET_NAME}.s3.${this.AWS_REGION}.amazonaws.com/${s3Key}`;

    // Save record in DB
    const fileRecord = await this.prisma.client.fileInstance.create({
      data: {
        filename: uniqueFileName,
        originalFilename: originalName || path.basename(filePath),
        path: s3Key,
        url: fileUrl,
        fileType: this.getFileType(mimeType),
        mimeType,
        size: fileBuffer.length,
      },
    });

    // Delete file from disk
    fs.unlinkSync(filePath);

    return fileRecord;
  }

  getFolderByMimeType(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'images';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'videos';
    return 'documents';
  }

  getFileType(mimeType: string): FileType {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType === 'application/pdf') return 'document';
    return 'any';
  }

  getMimeTypeFromExtension(ext: string): string {
    ext = ext.toLowerCase();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'svg':
        return 'image/svg+xml';
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'ogg':
        return 'video/ogg';
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'aac':
        return 'audio/aac';
      case 'pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }
}
