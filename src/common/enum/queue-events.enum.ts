export enum EventsEnum {
  // === Generic status events ===
  ERROR = 'error', // Server -> Client: operation failed
  SUCCESS = 'success', // Server -> Client: operation succeeded
}

export enum QueueEventsEnum {
  // === Notification events ===
  NOTIFICATION = 'queue:notification',
  MESSAGES = 'queue:messages',
  GENERIC = 'queue:generic',
}
