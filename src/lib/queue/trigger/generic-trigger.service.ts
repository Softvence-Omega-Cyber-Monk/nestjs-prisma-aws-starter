import { QueueEventsEnum } from '@/common/enum/queue-events.enum';
import { PrismaService } from '@/lib/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GenericPayload } from '../interface/generic.payload';

@Injectable()
export class GenericTriggerService {
  private readonly logger = new Logger(GenericTriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async emitEventToTriggerWorker() {
    try {
      const superAdmin = await this.prisma.client.user.findFirst({
        where: {
          role: 'SUPER_ADMIN',
        },
      });

      if (!superAdmin) {
        this.logger.warn('No super admin found');
        return;
      }

      const payload: GenericPayload = {
        adminId: superAdmin.id,
        message: 'This is a test message for the generic queue',
        admin: superAdmin,
      };

      // Emit asynchronously to avoid blocking event loop
      await this.eventEmitter.emitAsync(QueueEventsEnum.GENERIC, payload);
    } catch (err) {
      this.logger.error(`Failed to emit generic event`, err);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, {
    timeZone: 'America/New_York',
  })
  // @Cron(CronExpression.EVERY_10_SECONDS)
  async handleAmericaMorningCron() {
    await this.emitEventToTriggerWorker();
  }
}
