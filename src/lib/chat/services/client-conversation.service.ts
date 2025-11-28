import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { PaginationDto } from '@project/common/dto/pagination.dto';
import { HandleError } from '@project/common/error/handle-error.decorator';
import {
  successPaginatedResponse,
  TResponse,
} from '@project/common/utils/response.util';
import { PrismaService } from '@project/lib/prisma/prisma.service';
import { Socket } from 'socket.io';
import { EventsEnum } from '../../../common/enum/events.enum';
import { ChatGateway } from '../chat.gateway';

@Injectable()
export class ClientConversationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  @HandleError('Failed to load conversation of a client', 'ConversationService')
  async handleLoadClientConversation(
    client: Socket,
    payload: PaginationDto,
  ): Promise<TResponse<any>> {
    const limit = payload?.limit ?? 10;
    const page = payload?.page && +payload.page > 0 ? +payload.page : 1;
    const userId = client.data.userId;

    // Load conversation with messages + calls
    const conversation = await this.prisma.privateConversation.findFirst({
      where: { participants: { some: { userId } } },
      include: {
        participants: { include: { user: true } },
        messages: {
          include: { sender: true, file: true },
          orderBy: { createdAt: 'desc' },
        },
        calls: {
          include: { participants: { include: { user: true } } },
          orderBy: { startedAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!conversation) {
      client.emit(
        EventsEnum.CLIENT_CONVERSATION,
        successPaginatedResponse(
          [],
          { page, limit, total: 0 },
          'No conversation found',
        ),
      );
      return successPaginatedResponse(
        [],
        { page, limit, total: 0 },
        'No conversation found',
      );
    }

    // Normalize messages
    const normalizedMessages = conversation.messages.map((m) => ({
      id: m.id,
      type: 'MESSAGE',
      createdAt: m.createdAt,
      content: m.content,
      messageType: m.type,
      sender: {
        id: m.sender?.id,
        name: m.sender?.name,
        avatarUrl: m.sender?.avatarUrl,
        role: m.sender?.role,
        email: m.sender?.email,
      },
      file: m.file
        ? {
            id: m.file.id,
            url: m.file.url,
            type: m.file.fileType,
            mimeType: m.file.mimeType,
          }
        : null,
      isMine: m.sender?.id === userId,
      isSentByClient: m.sender?.id === userId,
    }));

    // Normalize calls
    const normalizedCalls = conversation.calls.map((c) => ({
      id: c.id,
      type: 'CALL',
      createdAt: c.startedAt,
      callType: c.type,
      status: c.status,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      initiatorId: c.initiatorId,
      participants: c.participants.map((p) => ({
        id: p.user.id,
        name: p.user.name,
        status: p.status,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      })),
      isMine: c.initiatorId === userId,
      isSentByClient: c.initiatorId === userId,
    }));

    // Merge and sort by time descending
    const conversationHistory = [
      ...normalizedMessages,
      ...normalizedCalls,
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = conversationHistory.length;
    const paginatedData = conversationHistory.slice(
      (page - 1) * limit,
      page * limit,
    );

    // Emit to client
    client.emit(
      EventsEnum.CLIENT_CONVERSATION,
      successPaginatedResponse(
        paginatedData,
        {
          page,
          limit,
          total,
        },
        'Conversation loaded successfully',
      ),
    );

    return successPaginatedResponse(
      paginatedData,
      {
        page,
        limit,
        total,
      },
      'Conversation loaded successfully',
    );
  }
}
