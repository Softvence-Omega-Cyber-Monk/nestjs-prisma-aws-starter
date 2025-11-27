import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { ENVEnum } from './common/enum/env.enum';
import { JwtStrategy } from './common/jwt/jwt.strategy';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { LibModule } from './lib/lib.module';
import { MainModule } from './main/main.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    CacheModule.register({
      isGlobal: true,
    }),

    EventEmitterModule.forRoot({
      global: true,
    }),

    ScheduleModule.forRoot(),

    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/api/files',
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const host = configService.getOrThrow<string>(ENVEnum.REDIS_HOST);
        const port = configService.getOrThrow<string>(ENVEnum.REDIS_PORT);

        return {
          connection: {
            host,
            port: parseInt(port, 10),
          },
        };
      },
    }),

    PassportModule,

    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        secret: await config.getOrThrow(ENVEnum.JWT_SECRET),
        signOptions: {
          expiresIn: await config.getOrThrow(ENVEnum.JWT_EXPIRES_IN),
        },
      }),
    }),

    LibModule,

    MainModule,
  ],
  controllers: [AppController],
  providers: [JwtStrategy],
  exports: [JwtStrategy],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
