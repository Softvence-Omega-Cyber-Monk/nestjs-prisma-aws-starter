import { FileType } from '@prisma';
import { IsEnum, IsNumber, IsString } from 'class-validator';

export class CreateFileDto {
  @IsString()
  filename: string;

  @IsString()
  originalFilename: string;

  @IsString()
  path: string;

  @IsString()
  url: string;

  @IsEnum(FileType)
  fileType: FileType;

  @IsString()
  mimeType: string;

  @IsNumber()
  size: number;
}
