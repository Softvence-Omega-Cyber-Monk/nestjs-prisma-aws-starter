import { PaginationDto } from '@/common/dto/pagination.dto';
import { AppError } from '@/common/error/handle-error.app';
import { HandleError } from '@/common/error/handle-error.decorator';
import {
  successPaginatedResponse,
  successResponse,
  TPaginatedResponse,
  TResponse,
} from '@/common/utils/response.util';
import { S3Service } from '@/lib/file/services/s3.service';
import { PrismaService } from '@/lib/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

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
      files.map((file) => this.s3.uploadFile(file)),
    );

    return successResponse(
      {
        files: results,
        count: results.length,
      },
      'Files uploaded successfully',
    );
  }

  @HandleError('Failed to delete files', 'File')
  async deleteFiles(fileIds: string[]): Promise<TResponse<any>> {
    if (!fileIds?.length) throw new AppError(400, 'No file IDs provided');

    const files = await this.prisma.client.fileInstance.findMany({
      where: { id: { in: fileIds } },
    });

    if (!files.length) throw new AppError(404, 'Files not found');

    // Parallelize deletes
    await Promise.all(files.map((f) => this.s3.deleteFile(f.id)));

    return successResponse(
      { files, count: files.length },
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
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.fileInstance.count(),
    ]);

    return successPaginatedResponse(
      files,
      { page, limit, total },
      'Files found',
    );
  }

  @HandleError('Failed to get file', 'File')
  async getFileById(id: string): Promise<TResponse<any>> {
    const file = await this.prisma.client.fileInstance.findUnique({
      where: { id },
    });

    if (!file) throw new AppError(404, 'File not found');

    return successResponse(file, 'File found');
  }
}
