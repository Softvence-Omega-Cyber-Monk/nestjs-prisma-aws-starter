import { EventsEnum } from '@/common/enum/queue-events.enum';
import { BaseGateway } from '@/common/socket/base.gateway';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationActionDto,
  InitConversationWithUserDto,
  LoadConversationsDto,
  LoadSingleConversationDto,
} from './dto/conversation.dto';
import { ConversationMutationService } from './services/conversation-mutation.service';
import { ConversationQueryService } from './services/conversation-query.service';

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
export class ChatGateway extends BaseGateway {
  constructor(
    protected readonly configService: ConfigService,
    protected readonly prisma: PrismaService,
    protected readonly jwtService: JwtService,
    private readonly conversationQueryService: ConversationQueryService,
    private readonly conversationMutationService: ConversationMutationService,
  ) {
    super(configService, prisma, jwtService, ChatGateway.name);
  }

  /** ---------------- Conversation Handlers ---------------- */
  @SubscribeMessage(EventsEnum.CONVERSATION_LOAD_LIST)
  async handleLoadConversations(client: Socket, dto: LoadConversationsDto) {
    return this.conversationQueryService.loadConversations(client, dto);
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_LOAD)
  async handleLoadSingleConversation(
    client: Socket,
    dto: LoadSingleConversationDto,
  ) {
    return this.conversationQueryService.loadSingleConversation(client, dto);
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_INITIATE)
  async handleInitiateConversation(
    client: Socket,
    dto: InitConversationWithUserDto,
  ) {
    return this.conversationMutationService.initiateConversationWithUser(
      client,
      dto,
    );
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_DELETE)
  async handleDeleteConversation(client: Socket, dto: ConversationActionDto) {
    return this.conversationMutationService.deleteConversation(client, dto);
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_ARCHIVE)
  async handleArchiveConversation(client: Socket, dto: ConversationActionDto) {
    return this.conversationMutationService.archiveConversation(client, dto);
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_BLOCK)
  async handleBlockConversation(client: Socket, dto: ConversationActionDto) {
    return this.conversationMutationService.blockConversation(client, dto);
  }

  @SubscribeMessage(EventsEnum.CONVERSATION_UNBLOCK)
  async handleUnblockConversation(client: Socket, dto: ConversationActionDto) {
    return this.conversationMutationService.unblockConversation(client, dto);
  }
}
