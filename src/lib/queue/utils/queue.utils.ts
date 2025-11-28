import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import crypto from 'node:crypto';

export async function enqueueJobHelper(
  queue: Queue,
  event: string,
  payload: any,
  uniqueKey: string,
  logger?: Logger,
) {
  const jobId = crypto
    .createHash('sha1')
    .update(`${event}:${uniqueKey}:${Date.now()}`)
    .digest('hex');
  logger?.log?.(`Enqueuing ${event} for jobId: ${jobId}`);

  try {
    await queue.add(event, payload, {
      removeOnComplete: true,
      removeOnFail: { count: 5 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      jobId,
    });

    logger?.log?.(`Successfully enqueued ${event} for jobId: ${jobId}`);
  } catch (error) {
    logger?.error?.(
      `Failed to enqueue ${event} for jobId: ${jobId}, error: ${error.message}`,
      error.stack,
      error,
    );
  }
}
