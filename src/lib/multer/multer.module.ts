import { Global, Module } from '@nestjs/common';
import { MulterService } from './multer.service';

@Global()
@Module({
  providers: [MulterService],
  exports: [MulterService],
})
export class MulterModule {}
