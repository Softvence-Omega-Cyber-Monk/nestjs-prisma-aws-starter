import { PrismaService } from '@/lib/prisma/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ENVEnum } from '../enum/env.enum';
import { JWTPayload } from './jwt.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const jwtSecret = config.getOrThrow<string>(ENVEnum.JWT_SECRET);

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JWTPayload) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Update lastActiveAt on each request
    await this.prisma.client.user.update({
      where: { id: payload.sub },
      data: { lastActiveAt: new Date() },
    });

    // Return payload for req.user
    return payload;
  }
}
