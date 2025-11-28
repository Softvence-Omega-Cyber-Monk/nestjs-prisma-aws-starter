import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventsEnum } from '@project/common/enum/events.enum';
import { HandleError } from '@project/common/error/handle-error.decorator';
import {
  successPaginatedResponse,
  TPaginatedResponse,
} from '@project/common/utils/response.util';
import { PrismaService } from '@project/lib/prisma/prisma.service';
import { Socket } from 'socket.io';
import { ChatGateway } from '../chat.gateway';
import { LoadConversationsDto } from '../dto/conversation.dto';

@Injectable()
export class ConversationService {
  private logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  @HandleError('Failed to load conversations', 'ConversationService')
  async handleLoadConversationsByAdmin(
    client: Socket,
    payload?: LoadConversationsDto,
  ): Promise<TPaginatedResponse<any>> {
    // Pagination
    const limit = payload?.limit ?? 10;
    const page = payload?.page && +payload.page > 0 ? +payload.page : 1;
    const search = payload?.search?.trim();

    // this.logger.log(`Loading conversations by admin`, {
    //   limit,
    //   page,
    //   search,
    // });

    const where: Prisma.PrivateConversationWhereInput = {};

    if (search) {
      where.participants = {
        some: {
          user: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          },
          type: 'USER',
        },
      };
    } else {
      where.participants = {
        some: { type: 'USER' },
      };
    }

    // RAW Conversations
    const [conversations, total] = await this.prisma.$transaction([
      this.prisma.privateConversation.findMany({
        include: {
          lastMessage: true,
          participants: {
            where: { type: 'USER' },
            include: { user: true },
          },
        },
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.prisma.privateConversation.count({ where }),
    ]);

    const outputData = conversations.map((conversation) => ({
      conversationId: conversation.id,
      lastMessage: conversation.lastMessage,
      profile: {
        id: conversation.participants[0].user?.id,
        name: conversation.participants[0].user?.name,
        avatarUrl: conversation.participants[0].user?.avatarUrl,
        role: conversation.participants[0].user?.role,
        email: conversation.participants[0].user?.email,
        isOnline: this.chatGateway.isOnline(
          conversation.participants[0].user?.id as string,
        ),
      },
    }));

    // Debug log so you can confirm this code runs
    this.logger.debug(
      `handleLoadConversationsByAdmin: sending ${outputData.length} items to socket ${client.id}`,
    );

    // Emit directly to the requesting socket (most reliable)
    try {
      this.chatGateway.server.to(client.data.userId).emit(
        EventsEnum.CONVERSATION_LIST,
        successPaginatedResponse(
          outputData,
          {
            limit,
            page,
            total,
          },
          'Conversations loaded successfully',
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to emit conversation list to ${client.id}: ${err?.message}`,
      );
    }

    // Response
    return successPaginatedResponse(
      outputData,
      { limit, page, total },
      'Conversations loaded successfully',
    );
  }
}
