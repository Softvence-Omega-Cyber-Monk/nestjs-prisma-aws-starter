import { CallType } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class InitiateCallDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsEnum(CallType)
  type: CallType;
}

export class CallActionDto {
  @IsString()
  @IsNotEmpty()
  callId: string;
}
