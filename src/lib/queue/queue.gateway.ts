import { ENVEnum } from '@/common/enum/env.enum';
import { EventsEnum } from '@/common/enum/queue-events.enum';
import { JWTPayload } from '@/common/jwt/jwt.interface';
import { errorResponse, successResponse } from '@/common/utils/response.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationPayload } from './interface/queue.payload';

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:5173',
      'http://localhost:5174',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  },
  namespace: '/queue',
})
@Injectable()
export class QueueGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(QueueGateway.name);
  private readonly clients = new Map<string, Set<Socket>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  @WebSocketServer()
  server: Server;

  /**--- INIT --- */
  afterInit(server: Server) {
    this.logger.log('Socket.IO server initialized', server.adapter?.name ?? '');
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractTokenFromSocket(client);
      if (!token) {
        return this.disconnectWithError(client, 'Missing token');
      }

      const payload = this.jwtService.verify<JWTPayload>(token, {
        secret: this.configService.getOrThrow(ENVEnum.JWT_SECRET),
      });

      if (!payload.sub) {
        return this.disconnectWithError(client, 'Invalid token payload');
      }

      const user = await this.prisma.client.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
        },
      });

      if (!user) return this.disconnectWithError(client, 'User not found');

      client.data.userId = user.id;
      client.data.user = payload;
      client.join(user.id);

      this.subscribeClient(user.id, client);

      this.logger.log(`User connected: ${user.id} (socket ${client.id})`);
      client.emit(EventsEnum.SUCCESS, successResponse(user));
    } catch (err: any) {
      this.disconnectWithError(client, err?.message ?? 'Auth failed');
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      this.unsubscribeClient(userId, client);
      client.leave(userId);
      this.logger.log(`Client disconnected: ${userId}`);
    } else {
      this.logger.log(
        `Client disconnected: unknown user (socket ${client.id})`,
      );
    }
  }

  /** ---------------- CLIENT HELPERS ---------------- */
  private subscribeClient(userId: string, client: Socket) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(client);
    this.logger.debug(`Subscribed client to user ${userId}`);
  }

  private unsubscribeClient(userId: string, client: Socket) {
    const set = this.clients.get(userId);
    if (!set) return;

    set.delete(client);
    this.logger.debug(`Unsubscribed client from user ${userId}`);
    if (set.size === 0) {
      this.clients.delete(userId);
      this.logger.debug(`Removed empty client set for user ${userId}`);
    }
  }

  private extractTokenFromSocket(client: Socket): string | null {
    const authHeader =
      (client.handshake.headers.authorization as string) ||
      (client.handshake.auth?.token as string);

    if (!authHeader) return null;
    return authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : authHeader;
  }

  /** ---------------- ERROR HELPERS ---------------- */
  public disconnectWithError(client: Socket, message: string) {
    this.emitError(client, message);
    client.disconnect(true);
    this.logger.warn(`Disconnect ${client.id}: ${message}`);
  }

  public emitError(client: Socket, message: string) {
    this.server
      .to(client.id)
      .emit(EventsEnum.ERROR, errorResponse(null, message));
    return errorResponse(null, message);
  }

  /** ---------------- Notification API ---------------- */
  public getClientsForUser(userId: string): Set<Socket> {
    return this.clients.get(userId) || new Set();
  }

  public async notifySingleUser(
    userId: string,
    event: string,
    data: NotificationPayload,
  ): Promise<void> {
    const clients = this.getClientsForUser(userId);

    // Store notification in DB
    const notification = await this.prisma.client.notification.create({
      data: {
        type: data.type,
        title: data.title,
        message: data.message,
        meta: data.meta ?? {},
        users: {
          create: {
            userId,
          },
        },
      },
    });

    // Attach newly created notificationId to payload
    const payload = {
      ...data,
      notificationId: notification.id,
    };

    // Emit only if user is connected
    if (clients.size === 0) {
      this.logger.warn(`No clients connected for user ${userId}`);
      return;
    }

    clients.forEach((client) => {
      client.emit(event, payload);
      this.logger.log(`Notification sent to user ${userId} via event ${event}`);
    });
  }

  public async notifyMultipleUsers(
    userIds: string[],
    event: string,
    data: NotificationPayload,
  ): Promise<void> {
    if (userIds.length === 0) {
      this.logger.warn('No user IDs provided for NotificationPayload');
      return;
    }

    userIds.forEach((userId) => {
      this.notifySingleUser(userId, event, data);
    });
  }

  public async notifyAllUsers(
    event: string,
    data: NotificationPayload,
  ): Promise<void> {
    this.clients.forEach((clients, userId) => {
      clients.forEach((client) => {
        client.emit(event, data);
        this.logger.log(
          `NotificationPayload sent to all users via event ${event} for user ${userId}`,
        );
      });
    });
  }

  public async emitToAdmins(
    event: string,
    data: NotificationPayload,
  ): Promise<void> {
    // 1. Get all admins
    const admins = await this.prisma.client.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      },
      select: { id: true },
    });

    if (admins.length === 0) {
      this.logger.warn('No admin found for emitToAdmins');
      return;
    }

    // 2. Create ONE notification record
    const notification = await this.prisma.client.notification.create({
      data: {
        type: data.type,
        title: data.title,
        message: data.message,
        meta: data.meta ?? {},
        // Attach all admins at once
        users: {
          createMany: {
            data: admins.map((a) => ({ userId: a.id })),
          },
        },
      },
    });

    const payload = {
      ...data,
      notificationId: notification.id,
    };

    // 3. Emit to every connected admin client
    admins.forEach((admin) => {
      const clients = this.getClientsForUser(admin.id);

      if (clients.size === 0) return;

      clients.forEach((client) => {
        client.emit(event, payload);
      });
    });

    this.logger.log(
      `Notification sent to ${admins.length} admins (event: ${event})`,
    );
  }
}
