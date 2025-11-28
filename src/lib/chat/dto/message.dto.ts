import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageDeliveryStatus, MessageType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// ----------------------
// Base DTO
// ----------------------
export class BaseMessageDto {
  @ApiPropertyOptional({ description: 'Message content' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ enum: MessageType, description: 'Type of message' })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({ description: 'File ID if sending a file' })
  @IsOptional()
  @IsString()
  fileId?: string;
}

// ----------------------
// Client → Admin
// ----------------------
export class ClientMessageDto extends BaseMessageDto {}

// ----------------------
// Admin → Client
// ----------------------
export class AdminMessageDto extends BaseMessageDto {
  @ApiProperty({ description: 'Client ID to send message to' })
  @IsNotEmpty()
  @IsString()
  clientId: string;
}

// ----------------------
// Mark message as read
// ----------------------
export class MarkReadDto {
  @ApiProperty({ description: 'IDs of messages to mark as read' })
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  messageIds: string[];
}

// ----------------------
// Delete message
// ----------------------
export class DeleteMessageDto {
  @ApiProperty({ description: 'ID of the message to delete' })
  @IsNotEmpty()
  @IsString()
  messageId: string;
}

export class MessageDeliveryStatusDto {
  @ApiProperty({ description: 'ID of the message to update status' })
  @IsNotEmpty()
  @IsString()
  messageId: string;

  @ApiProperty({
    enum: MessageDeliveryStatus,
    description: 'Status of message',
  })
  @IsNotEmpty()
  @IsEnum(MessageDeliveryStatus)
  status: MessageDeliveryStatus;

  @ApiProperty({ description: 'User ID to update status for' })
  @IsNotEmpty()
  @IsString()
  userId: string;
}
