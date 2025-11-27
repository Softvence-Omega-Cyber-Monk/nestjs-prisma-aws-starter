import { Global, Module } from '@nestjs/common';
import { FileService } from './services/file.service';
import { SuperAdminService } from './services/super-admin.service';

@Global()
@Module({
  imports: [],
  providers: [SuperAdminService, FileService],
})
export class SeedModule {}
