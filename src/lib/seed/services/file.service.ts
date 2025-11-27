import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FileService implements OnModuleInit {
  private readonly logger = new Logger(FileService.name);

  async onModuleInit() {
    this.logger.log('FileService initialized and directories checked.');
    this.ensureDirectoriesExist(['uploads', 'temp']);
  }

  private ensureDirectoriesExist(folders: string[]) {
    for (const folder of folders) {
      const fullPath = path.join(process.cwd(), folder);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        this.logger.log(`Created missing folder: ${fullPath}`);
      } else {
        this.logger.log(`Folder already exists: ${fullPath}`);
      }
    }
  }
}
