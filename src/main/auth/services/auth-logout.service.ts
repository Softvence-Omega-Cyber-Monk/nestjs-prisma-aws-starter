import { AppError } from '@/common/error/handle-error.app';
import { HandleError } from '@/common/error/handle-error.decorator';
import { TokenPair } from '@/common/jwt/jwt.interface';
import { successResponse, TResponse } from '@/common/utils/response.util';
import { PrismaService } from '@/lib/prisma/prisma.service';
import { AuthUtilsService } from '@/lib/utils/services/auth-utils.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { LogoutDto, RefreshTokenDto } from '../dto/logout.dto';

@Injectable()
export class AuthLogoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly utils: AuthUtilsService,
  ) {}

  @HandleError('Logout user failed', 'User')
  async logout(userId: string, dto: LogoutDto): Promise<TResponse<any>> {
    // Ensure refresh token exists and belongs to the user
    const tokenRecord = await this.utils.findRefreshToken(dto.refreshToken);

    if (!tokenRecord || tokenRecord.userId !== userId) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Invalid refresh token');
    }

    // Delete the provided refresh token (logout)
    await this.utils.revokeAllRefreshTokensForUser(userId);

    return successResponse(null, 'Logout successful');
  }

  @HandleError('Refresh token failed')
  async refresh(dto: RefreshTokenDto): Promise<TResponse<TokenPair>> {
    const tokenRecord = await this.utils.findRefreshToken(dto.refreshToken);

    if (!tokenRecord) {
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        'Invalid or expired refresh token',
      );
    }

    // Check expiration
    if (tokenRecord.expiresAt < new Date()) {
      await this.utils.revokeRefreshToken(dto.refreshToken);
      throw new AppError(HttpStatus.UNAUTHORIZED, 'Refresh token expired');
    }

    // Get user info
    const user = await this.prisma.client.user.findUnique({
      where: { id: tokenRecord.userId },
    });

    if (!user) {
      await this.utils.revokeRefreshToken(dto.refreshToken);
      throw new AppError(HttpStatus.UNAUTHORIZED, 'User not found');
    }

    // Revoke old refresh token (rotation)
    await this.utils.revokeRefreshToken(dto.refreshToken);

    // Generate new access + refresh tokens
    const tokenPair = await this.utils.generateTokenPairAndSave({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return successResponse(tokenPair, 'Token refreshed successfully');
  }
}
