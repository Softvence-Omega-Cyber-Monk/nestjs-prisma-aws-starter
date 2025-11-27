import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class DeleteFilesRequestDto {
  @ApiProperty({
    type: [String],
    description: 'Array of file IDs to delete',
    example: ['uuid-1', 'uuid-2'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  fileIds: string[];
}
