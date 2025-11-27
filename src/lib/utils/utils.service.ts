import { UserResponseDto } from '@/common/dto/user-response.dto';
import { ENVEnum } from '@/common/enum/env.enum';
import { JWTPayload } from '@/common/jwt/jwt.interface';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UtilsService {
  private readonly saltRounds = 10;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  sanitizedResponse(dto: any, data: any) {
    return plainToInstance(dto, data, { excludeExtraneousValues: true });
  }

  sanitizeWithRelations<T>(
    dto: ClassConstructor<any>,
    entity: Record<string, any>,
  ): T {
    // Separate scalar fields from relations
    const scalars: Record<string, any> = {};
    const relations: Record<string, any> = {};

    for (const key in entity) {
      const value = entity[key];
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        // This is either a relation object or a Prisma _count
        relations[key] = value;
      } else if (Array.isArray(value)) {
        // Relation arrays
        relations[key] = value;
      } else {
        // Scalar value
        scalars[key] = value;
      }
    }

    // Sanitize only scalars
    const sanitizedBase = this.sanitizedResponse(dto, scalars);

    // Merge sanitized scalars back with untouched relations
    return {
      ...sanitizedBase,
      ...relations,
    } as T;
  }

  removeDuplicateIds(ids: string[]) {
    return Array.from(new Set(ids));
  }

  async hash(value: string): Promise<string> {
    return bcrypt.hash(value, this.saltRounds);
  }

  async compare(value: string, hash: string): Promise<boolean> {
    return bcrypt.compare(value, hash);
  }

  generateToken(payload: JWTPayload): string {
    const token = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow(ENVEnum.JWT_SECRET),
      expiresIn: this.configService.getOrThrow(ENVEnum.JWT_EXPIRES_IN),
    });

    return token;
  }

  generateOtpAndExpiry(): { otp: number; expiryTime: Date } {
    // Use crypto for more secure randomness
    const otp = randomInt(1000, 10000); // 4-digit OTP

    // Set expiry 10 minutes from now
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000);

    return { otp, expiryTime };
  }

  async getUserByEmail(email: string) {
    const user = await this.prisma.client.user.findUnique({ where: { email } });

    return this.sanitizedResponse(UserResponseDto, user);
  }

  async getUserEmailById(id: string) {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id },
      include: { profilePicture: true },
    });

    return user.email;
  }

  safeParseJson<T>(value: any, fallback: T): T {
    try {
      if (typeof value === 'string') {
        return JSON.parse(value);
      }
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }
}
