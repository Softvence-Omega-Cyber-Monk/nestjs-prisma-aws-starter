import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ example: 'refreshToken' })
  @IsString()
  refreshToken: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'refreshToken' })
  @IsString()
  refreshToken: string;
}
