import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@project/common/dto/pagination.dto';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// ----------------------
// Load conversations
// ----------------------
export class LoadConversationsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search query' })
  @IsOptional()
  @IsString()
  search: string;
}

// ----------------------
// Load single conversation
// ----------------------
export class LoadSingleConversationDto extends PaginationDto {
  @ApiProperty({ description: 'ID of the conversation to load' })
  @IsNotEmpty()
  @IsString()
  conversationId: string;
}

export class InitConversationWithClientDto {
  @ApiProperty({ description: 'Client ID to send message to' })
  @IsNotEmpty()
  @IsString()
  clientId: string;
}
