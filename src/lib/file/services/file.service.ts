import { AppError } from '@/common/error/handle-error.app';
import { HandleError } from '@/common/error/handle-error.decorator';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileType } from '@prisma';
import * as fs from 'fs';
import mime from 'mime-types';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFileDto } from '../dto/create-file.dto';

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @HandleError('Error creating file', 'file')
  async create(createFileDto: CreateFileDto) {
    const file = await this.prisma.client.fileInstance.create({
      data: createFileDto,
    });

    if (!file) {
      throw new AppError(400, 'Error creating file');
    }

    return file;
  }

  @HandleError('Error finding file', 'file')
  async findOne(id: string) {
    const file = await this.prisma.client.fileInstance.findUnique({
      where: { id },
    });

    if (!file) {
      throw new AppError(400, 'Error creating file');
    }

    return file;
  }

  @HandleError('Error finding file', 'file')
  async findByFilename(filename: string) {
    const file = await this.prisma.client.fileInstance.findFirst({
      where: { filename },
    });

    if (!file) {
      throw new AppError(400, 'Error creating file');
    }

    return file;
  }

  @HandleError('Error deleting file', 'file')
  async remove(id: string): Promise<void> {
    const file = await this.findOne(id);

    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      console.warn(`Could not delete physical file at ${file.path}:`, error);
      throw new AppError(400, 'Error deleting file');
    }

    await this.prisma.client.fileInstance.delete({
      where: { id },
    });
  }

  @HandleError('Error processing uploaded file', 'file')
  async processUploadedFile(file: Express.Multer.File) {
    const fileId = uuidv4();
    const fileExt = path.extname(file.originalname);
    const filename = `${fileId}${fileExt}`;

    const mimeType =
      file.mimetype ||
      mime.lookup(file.originalname) ||
      'application/octet-stream';

    const fileType = this.mapMimeToPrismaFileType(mimeType);

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);

    const fileUrl = `${this.configService.getOrThrow<string>('BASE_URL')}/files/${filename}`;

    if (file.path && file.path !== filePath) {
      fs.copyFileSync(file.path, filePath);
      fs.unlinkSync(file.path);
    }

    const createFileDto: CreateFileDto = {
      filename,
      originalFilename: file.originalname,
      path: filePath,
      url: fileUrl,
      fileType,
      mimeType,
      size: file.size,
    };

    return this.create(createFileDto);
  }

  private mapMimeToPrismaFileType(
    mimeType: string | null | undefined,
  ): FileType {
    const top = (mimeType || '').split('/')[0].toLowerCase();

    switch (top) {
      case 'image':
        return FileType.image;
      case 'video':
        return FileType.video;
      case 'audio':
        return FileType.audio;
      case 'text':
        return FileType.document;
      case 'application':
        // Most "application/*" files are documents (pdf/doc/xls/json/etc.)
        // If you have a special enum value for other application types, handle here.
        return FileType.docs;
      default:
        // Fallback — change to FileType.ANY if your schema supports it and you prefer that.
        return FileType.any;
    }
  }
}
