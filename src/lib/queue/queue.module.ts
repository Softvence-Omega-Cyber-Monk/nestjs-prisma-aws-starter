import { QueueName } from '@/common/enum/queue-name.enum';
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { GenericEventsService } from './events/generic-events.service';
import { QueueGateway } from './queue.gateway';
import { GenericTriggerService } from './trigger/generic-trigger.service';
import { GenericWorkerService } from './worker/generic-worker.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QueueName.NOTIFICATION },
      { name: QueueName.GENERIC },
    ),
  ],
  providers: [
    QueueGateway,
    GenericTriggerService,
    GenericEventsService,
    GenericWorkerService,
  ],
  exports: [BullModule],
})
export class QueueModule {}
