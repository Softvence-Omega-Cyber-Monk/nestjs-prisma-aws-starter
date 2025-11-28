import { QueueEventsEnum } from '@/common/enum/queue-events.enum';
import { QueueName } from '@/common/enum/queue-name.enum';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';

import { GenericPayload } from '../interface/generic.payload';
import { enqueueJobHelper } from '../utils/queue.utils';

@Injectable()
export class GenericEventsService {
  private readonly logger = new Logger(GenericEventsService.name);

  constructor(
    @InjectQueue(QueueName.GENERIC)
    private readonly genericQueue: Queue,
  ) {}

  @OnEvent(QueueEventsEnum.GENERIC)
  async handleGenericEvent(payload: GenericPayload) {
    await enqueueJobHelper(
      this.genericQueue,
      QueueEventsEnum.GENERIC,
      payload,
      payload.adminId,
      this.logger,
    );
  }
}
