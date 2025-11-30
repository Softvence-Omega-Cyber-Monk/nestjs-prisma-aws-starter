import { EventsEnum } from '@/common/enum/queue-events.enum';
import { errorResponse } from '@/common/utils/response.util';
import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';

export function SocketSafe() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const logger = new Logger('SocketSafe');

    descriptor.value = async function (...args: any[]) {
      const client: Socket = args[0];

      // Ensure the first argument is a Socket
      if (!client || !client.emit) {
        logger.error(
          `@SocketSafe: First argument must be a Socket in ${target.constructor.name}.${propertyKey}`,
        );
        throw new Error('Internal Server Error');
      }

      // Auth Check
      if (!client.data?.userId) {
        client.emit(EventsEnum.ERROR, errorResponse(null, 'Unauthorized'));
        return errorResponse(null, 'Unauthorized');
      }

      try {
        return await originalMethod.apply(this, args);
      } catch (err: any) {
        logger.error(
          `Error in ${target.constructor.name}.${propertyKey}: ${err.message}`,
          err.stack,
        );
        const message = err?.message ?? 'Internal Server Error';
        client.emit(EventsEnum.ERROR, errorResponse(null, message));
        return errorResponse(null, message);
      }
    };

    return descriptor;
  };
}
