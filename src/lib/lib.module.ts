import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { FileModule } from './file/file.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { S3Module } from './s3/s3.module';
import { SeedModule } from './seed/seed.module';
import { UtilsModule } from './utils/utils.module';

@Module({
  imports: [
    PrismaModule,
    FileModule,
    MailModule,
    MulterModule,
    SeedModule,
    UtilsModule,
    S3Module,
  ],
  exports: [],
  providers: [],
})
export class LibModule {}
