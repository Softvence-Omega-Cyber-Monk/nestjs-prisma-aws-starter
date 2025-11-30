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
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationActionDto,
  InitConversationWithUserDto,
  LoadConversationsDto,
  LoadSingleConversationDto,
} from './dto/conversation.dto';
import { ConversationService } from './services/conversation.service';

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
  namespace: '/chat',
})
@Injectable()
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);
  private readonly clients = new Map<string, Set<Socket>>();

  isOnline(userId: string) {
    return this.clients.has(userId);
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly conversationService: ConversationService,
  ) {}

  @WebSocketServer()
  server: Server;

  /**--- INIT --- */
  afterInit(server: Server) {
    this.logger.log('Socket.IO server initialized', server.adapter?.name ?? '');
  }

  /** --- CONNECTION --- */
  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) return this.disconnectWithError(client, 'Missing token');

      const payload = this.jwtService.verify<JWTPayload>(token, {
        secret: this.configService.getOrThrow(ENVEnum.JWT_SECRET),
      });

      if (!payload.sub)
        return this.disconnectWithError(client, 'Invalid token');

      const user = await this.prisma.client.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, name: true },
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

  /** --- CLIENT MANAGEMENT --- */
  private subscribeClient(userId: string, client: Socket) {
    const set = this.clients.get(userId) ?? new Set<Socket>();
    set.add(client);
    this.clients.set(userId, set);
    this.logger.debug(`Subscribed client to user ${userId}`);
  }

  private unsubscribeClient(userId: string, client: Socket) {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.clients.delete(userId);
    this.logger.debug(`Unsubscribed client from user ${userId}`);
  }

  private extractToken(client: Socket): string | null {
    const auth =
      (client.handshake.headers.authorization as string) ||
      (client.handshake.auth?.token as string);
    if (!auth) return null;
    return auth.startsWith('Bearer ') ? auth.split(' ')[1] : auth;
  }

  /** --- ERROR HANDLING --- */
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

  /** ---------------- Socket helpers  ---------------- */
  public getActiveSocketIdsForUser(
    userId: string,
    excludeSocketId?: string,
  ): string[] {
    const set = this.clients.get(userId);
    if (!set) return [];
    const ids: string[] = [];
    for (const sock of set) {
      if (sock && sock.id !== excludeSocketId) ids.push(sock.id);
    }
    return ids;
  }

  public emitToSocketId(
    socketId: string,
    event: EventsEnum | string,
    payload: any,
  ) {
    this.server.to(socketId).emit(event, payload);
  }

  public emitToUserFirstSocket(
    userId: string,
    event: EventsEnum | string,
    payload: any,
    excludeSocketId?: string,
  ) {
    const ids = this.getActiveSocketIdsForUser(userId, excludeSocketId);
    if (ids.length === 0) return false;
    this.emitToSocketId(ids[0], event, payload);
    return true;
  }

  /** ---------------- Conversation Handlers ---------------- */
  @SubscribeMessage(EventsEnum.CONVERSATION_LOAD_LIST)
  async handleLoadConversations(client: Socket, dto: LoadConversationsDto) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        return this.emitError(client, 'Unauthorized');
      }

      this.logger.debug(`User ${userId} loading conversations`);

      const result = await this.conversationService.loadConversations(
        userId,
        dto,
      );

      client.emit(
        EventsEnum.CONVERSATION_LIST_RESPONSE,
        successResponse(result),
      );
      return successResponse(result);
    } catch (err: any) {
      this.logger.error('Failed to load conversations', err);
      return this.emitError(
        client,
        err?.message ?? 'Failed to load conversations',
      );
    }
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_LOAD)
  async handleLoadSingleConversation(
    client: Socket,
    dto: LoadSingleConversationDto,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        return this.emitError(client, 'Unauthorized');
      }

      this.logger.debug(
        `User ${userId} loading conversation ${dto.conversationId}`,
      );

      const result = await this.conversationService.loadSingleConversation(
        userId,
        dto,
      );

      client.emit(EventsEnum.CONVERSATION_RESPONSE, successResponse(result));
      return successResponse(result);
    } catch (err: any) {
      this.logger.error('Failed to load conversation', err);
      return this.emitError(
        client,
        err?.message ?? 'Failed to load conversation',
      );
    }
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_INITIATE)
  async handleInitiateConversation(
    client: Socket,
    dto: InitConversationWithUserDto,
  ) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        return this.emitError(client, 'Unauthorized');
      }

      this.logger.debug(
        `User ${userId} initiating conversation with ${dto.userId}`,
      );

      const conversation =
        await this.conversationService.initiateConversationWithUser(
          userId,
          dto,
        );

      client.emit(EventsEnum.SUCCESS, successResponse(conversation));

      // Notify the other participant if online
      const otherUserId = conversation.participant.id;
      this.emitToUserFirstSocket(
        otherUserId,
        EventsEnum.CONVERSATION_UPDATE,
        successResponse(conversation),
      );

      return successResponse(conversation);
    } catch (err: any) {
      this.logger.error('Failed to initiate conversation', err);
      return this.emitError(
        client,
        err?.message ?? 'Failed to initiate conversation',
      );
    }
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_DELETE)
  async handleDeleteConversation(client: Socket, dto: ConversationActionDto) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        return this.emitError(client, 'Unauthorized');
      }

      this.logger.debug(
        `User ${userId} deleting conversation ${dto.conversationId}`,
      );

      // Get conversation details before deleting to notify other participant
      const conversationData =
        await this.prisma.client.privateConversation.findFirst({
          where: {
            id: dto.conversationId,
            OR: [{ initiatorId: userId }, { receiverId: userId }],
          },
        });

      if (!conversationData) {
        return this.emitError(client, 'Conversation not found or unauthorized');
      }

      const otherUserId =
        conversationData.initiatorId === userId
          ? conversationData.receiverId
          : conversationData.initiatorId;

      await this.conversationService.deleteConversation(userId, dto);

      client.emit(EventsEnum.SUCCESS, successResponse({ success: true }));

      // Notify the other participant if online
      this.emitToUserFirstSocket(
        otherUserId,
        EventsEnum.CONVERSATION_UPDATE,
        successResponse({
          conversationId: dto.conversationId,
          action: 'deleted',
        }),
      );

      return successResponse({ success: true });
    } catch (err: any) {
      this.logger.error('Failed to delete conversation', err);
      return this.emitError(
        client,
        err?.message ?? 'Failed to delete conversation',
      );
    }
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_ARCHIVE)
  async handleArchiveConversation(client: Socket, dto: ConversationActionDto) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        return this.emitError(client, 'Unauthorized');
      }

      this.logger.debug(
        `User ${userId} archiving conversation ${dto.conversationId}`,
      );

      const conversation = await this.conversationService.archiveConversation(
        userId,
        dto,
      );

      client.emit(
        EventsEnum.CONVERSATION_UPDATE,
        successResponse(conversation),
      );
      return successResponse(conversation);
    } catch (err: any) {
      this.logger.error('Failed to archive conversation', err);
      return this.emitError(
        client,
        err?.message ?? 'Failed to archive conversation',
      );
    }
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_BLOCK)
  async handleBlockConversation(client: Socket, dto: ConversationActionDto) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        return this.emitError(client, 'Unauthorized');
      }

      this.logger.debug(
        `User ${userId} blocking conversation ${dto.conversationId}`,
      );

      const conversation = await this.conversationService.blockConversation(
        userId,
        dto,
      );

      client.emit(
        EventsEnum.CONVERSATION_UPDATE,
        successResponse(conversation),
      );

      // Notify the other participant if online
      const otherUserId = conversation.participant.id;
      this.emitToUserFirstSocket(
        otherUserId,
        EventsEnum.CONVERSATION_UPDATE,
        successResponse({
          conversationId: dto.conversationId,
          action: 'blocked',
        }),
      );

      return successResponse(conversation);
    } catch (err: any) {
      this.logger.error('Failed to block conversation', err);
      return this.emitError(
        client,
        err?.message ?? 'Failed to block conversation',
      );
    }
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_UNBLOCK)
  async handleUnblockConversation(client: Socket, dto: ConversationActionDto) {
    try {
      const userId = client.data.userId;
      if (!userId) {
        return this.emitError(client, 'Unauthorized');
      }

      this.logger.debug(
        `User ${userId} unblocking conversation ${dto.conversationId}`,
      );

      const conversation = await this.conversationService.unblockConversation(
        userId,
        dto,
      );

      client.emit(
        EventsEnum.CONVERSATION_UPDATE,
        successResponse(conversation),
      );

      // Notify the other participant if online
      const otherUserId = conversation.participant.id;
      this.emitToUserFirstSocket(
        otherUserId,
        EventsEnum.CONVERSATION_UPDATE,
        successResponse({
          conversationId: dto.conversationId,
          action: 'unblocked',
        }),
      );

      return successResponse(conversation);
    } catch (err: any) {
      this.logger.error('Failed to unblock conversation', err);
      return this.emitError(
        client,
        err?.message ?? 'Failed to unblock conversation',
      );
    }
  }
}
