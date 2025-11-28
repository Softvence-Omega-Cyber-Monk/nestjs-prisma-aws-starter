import { QueueEventsEnum } from '@/common/enum/queue-events.enum';
import { QueueName } from '@/common/enum/queue-name.enum';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GenericPayload } from '../interface/generic.payload';
import { NotificationPayload } from '../interface/queue.payload';
import { QueueGateway } from '../queue.gateway';

@Processor(QueueName.GENERIC, { concurrency: 5 })
export class GenericWorkerService extends WorkerHost {
  private readonly logger = new Logger(GenericWorkerService.name);

  constructor(private readonly gateway: QueueGateway) {
    super();
  }

  async process(job: Job<GenericPayload>): Promise<void> {
    const { admin, message, adminId } = job.data;

    this.logger.log(`Processing job ${job.id} for admin ${adminId}`);

    try {
      // ✅ Replace with actual job logic in specific projects
      // e.g., sync, update, external API call, etc.

      // Generic admin notification
      const notification: NotificationPayload = {
        type: QueueEventsEnum.NOTIFICATION,
        title: `Job completed: ${admin.name}`,
        message,
        createdAt: new Date(),
        meta: {
          recordType: 'User',
          recordId: admin.id,
          performedBy: admin.name,
        },
      };

      await this.gateway.emitToAdmins(
        QueueEventsEnum.NOTIFICATION,
        notification,
      );
    } catch (err) {
      this.logger.error(
        `Job ${job.id} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err; // allows retry/backoff
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: any) {
    this.logger.error(`Job ${job.id} failed: ${err?.message}`);
  }
}
