import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class RTCOfferDto {
  @IsString()
  @IsNotEmpty()
  callId: string;

  @IsString()
  @IsNotEmpty()
  sdp: string;

  @IsString()
  @IsNotEmpty()
  to: string;

  @IsOptional()
  @IsString()
  from?: string;
}

export class RTCAnswerDto {
  @IsString()
  @IsNotEmpty()
  callId: string;

  @IsString()
  @IsNotEmpty()
  sdp: string;

  @IsString()
  @IsNotEmpty()
  to: string;

  @IsOptional()
  @IsString()
  from?: string;
}

export class RTCIceCandidateDto {
  @IsString()
  @IsNotEmpty()
  callId: string;

  @IsString()
  @IsNotEmpty()
  candidate: string;

  @IsString()
  @IsNotEmpty()
  sdpMid: string;

  @Type(() => Number)
  @IsNumber()
  sdpMLineIndex: number;

  @IsString()
  @IsNotEmpty()
  to: string;

  @IsOptional()
  @IsString()
  from?: string;
}
