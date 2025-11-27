import { ApiProperty } from '@nestjs/swagger';

export class UploadFilesRequestDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'File(s) to upload',
    isArray: true,
  })
  files: Express.Multer.File[];
}
