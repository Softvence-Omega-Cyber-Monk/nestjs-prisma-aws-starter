import { QueueEventsEnum } from '@/common/enum/queue-events.enum';

interface Meta {
  performedBy: string; // System or any user
  recordType: string; // Prisma model
  recordId: string; // Prisma model ID
  others?: Record<string, any>; // Additional data
  [key: string]: any; // Allow extra fields
}

interface NotificationPayload {
  type: QueueEventsEnum;
  title: string;
  message: string;
  createdAt: Date;
  meta: Meta;
}

interface QueuePayload extends NotificationPayload {
  recipients: { id: string }[];
}

export type { Meta, NotificationPayload, QueuePayload };
