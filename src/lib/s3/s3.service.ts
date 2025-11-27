import { PaginationDto } from '@/common/dto/pagination.dto';
import { ENVEnum } from '@/common/enum/env.enum';
import { AppError } from '@/common/error/handle-error.app';
import { HandleError } from '@/common/error/handle-error.decorator';
import {
  successPaginatedResponse,
  successResponse,
  TPaginatedResponse,
  TResponse,
} from '@/common/utils/response.util';
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

  @HandleError('Failed to upload file(s)', 'File')
  async uploadFiles(files: Express.Multer.File[]): Promise<TResponse<any>> {
    if (!files || files.length === 0) {
      throw new AppError(404, 'No file(s) uploaded');
    }

    if (files.length > 5) {
      throw new AppError(400, 'You can upload a maximum of 5 files');
    }

    // Parallelize uploads
    const results = await Promise.all(
      files.map((file) => this.uploadFile(file)),
    );

    return successResponse(
      {
        files: results,
        count: results.length,
      },
      'Files uploaded successfully',
    );
  }

  @HandleError('Failed to delete file(s)', 'File')
  async deleteFiles(fileIds: string[]): Promise<TResponse<any>> {
    if (!fileIds || fileIds.length === 0) {
      throw new AppError(400, 'No file IDs provided');
    }

    // Fetch files from DB
    const files = await this.prisma.client.fileInstance.findMany({
      where: { id: { in: fileIds } },
    });

    if (!files || files.length === 0) {
      throw new AppError(400, 'No files found for provided IDs');
    }

    // Delete from S3
    await Promise.all(
      files.map((file) =>
        this.s3.send(
          new DeleteObjectCommand({
            Bucket: this.AWS_S3_BUCKET_NAME,
            Key: file.path,
          }),
        ),
      ),
    );

    // Delete from DB
    await this.prisma.client.fileInstance.deleteMany({
      where: { id: { in: fileIds } },
    });

    return successResponse(
      {
        files,
        count: files.length,
      },
      'Files deleted successfully',
    );
  }

  @HandleError('Failed to get files', 'File')
  async getFiles(pg: PaginationDto): Promise<TPaginatedResponse<any>> {
    const page = pg.page && +pg.page > 0 ? +pg.page : 1;
    const limit = pg.limit && +pg.limit > 0 ? +pg.limit : 10;
    const skip = (page - 1) * limit;

    const [files, total] = await this.prisma.client.$transaction([
      this.prisma.client.fileInstance.findMany({
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.fileInstance.count(),
    ]);

    return successPaginatedResponse(
      files,
      {
        page,
        limit,
        total,
      },
      'Files found successfully',
    );
  }

  @HandleError('Failed to get file', 'File')
  async getFileById(id: string): Promise<TResponse<any>> {
    const file = await this.prisma.client.fileInstance.findUnique({
      where: { id },
    });

    if (!file) {
      throw new AppError(404, 'File not found');
    }

    return successResponse(file, 'File found successfully');
  }

  // Private Helpers
  async uploadFile(file: Express.Multer.File) {
    const fileExt = file.originalname.split('.').pop();
    const folder = this.getFolderByMimeType(file.mimetype);
    const uniqueFileName = `${uuid()}.${fileExt}`;
    const s3Key = `${folder}/${uniqueFileName}`;

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: this.AWS_S3_BUCKET_NAME,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await this.s3.send(command);

    // Construct file URL
    const fileUrl = `https://${this.AWS_S3_BUCKET_NAME}.s3.${this.AWS_REGION}.amazonaws.com/${s3Key}`;

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

  private getFolderByMimeType(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'images';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'videos';
    return 'documents';
  }

  private getFileType(mimeType: string): FileType {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType === 'application/pdf') return 'document';
    return 'any';
  }

  private getMimeTypeFromExtension(ext: string): string {
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
