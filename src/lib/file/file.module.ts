import { Global, Module } from '@nestjs/common';
import { FileService } from './services/file.service';
import { MulterService } from './services/multer.service';
import { S3Service } from './services/s3.service';

@Global()
@Module({
  providers: [FileService, S3Service, MulterService],
  exports: [FileService, S3Service, MulterService],
})
export class FileModule {}
