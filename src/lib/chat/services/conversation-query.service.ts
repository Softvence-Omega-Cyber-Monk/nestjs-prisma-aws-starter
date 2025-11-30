import { EventsEnum } from '@/common/enum/queue-events.enum';
import { SocketSafe } from '@/common/socket/socket-safe.decorator';
import { successResponse } from '@/common/utils/response.util';
import { PrismaService } from '@/lib/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import {
  LoadConversationsDto,
  LoadSingleConversationDto,
} from '../dto/conversation.dto';

@Injectable()
export class ConversationQueryService {
  private logger = new Logger(ConversationQueryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load paginated list of conversations for a user
   */
  @SocketSafe()
  async loadConversations(client: Socket, dto: LoadConversationsDto) {
    const userId = client.data.userId;
    const { page = 1, limit = 20, search } = dto;
    const skip = (page - 1) * limit;

    this.logger.debug(
      `Loading conversations for user ${userId}, page ${page}, limit ${limit}`,
    );

    // Build where clause for search
    const whereClause: any = {
      OR: [{ initiatorId: userId }, { receiverId: userId }],
    };

    if (search) {
      whereClause.AND = {
        OR: [
          {
            initiator: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
          {
            receiver: {
              name: { contains: search, mode: 'insensitive' },
            },
          },
          {
            lastMessage: {
              content: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      };
    }

    const [conversations, total] = await Promise.all([
      this.prisma.client.privateConversation.findMany({
        where: whereClause,
        include: {
          initiator: {
            select: {
              id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          receiver: {
            select: {
              id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          lastMessage: {
            include: {
              sender: {
                select: {
                  id: true,
                  name: true,
                },
              },
              file: true,
              statuses: {
                where: { userId },
              },
            },
          },
          messages: {
            where: {
              senderId: { not: userId },
              statuses: {
                some: {
                  userId,
                  status: { not: 'READ' },
                },
              },
            },
            select: { id: true },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.client.privateConversation.count({ where: whereClause }),
    ]);

    // Transform conversations to include participant and unread count
    const transformedConversations = conversations.map((conv) => {
      const otherParticipant =
        conv.initiatorId === userId ? conv.receiver : conv.initiator;
      const unreadCount = conv.messages.length;

      return {
        id: conv.id,
        participant: otherParticipant,
        lastMessage: conv.lastMessage,
        unreadCount,
        status: conv.status,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      };
    });

    this.logger.log(
      `Loaded ${transformedConversations.length} conversations for user ${userId}`,
    );

    const result = {
      conversations: transformedConversations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    client.emit(EventsEnum.CONVERSATION_LIST_RESPONSE, successResponse(result));
    return successResponse(result);
  }

  /**
   * Load a single conversation with paginated messages
   */
  @SocketSafe()
  async loadSingleConversation(client: Socket, dto: LoadSingleConversationDto) {
    const userId = client.data.userId;
    const { conversationId, page = 1, limit = 50 } = dto;
    const skip = (page - 1) * limit;

    this.logger.debug(
      `Loading conversation ${conversationId} for user ${userId}`,
    );

    // Verify user is a participant
    const conversation = await this.prisma.client.privateConversation.findFirst(
      {
        where: {
          id: conversationId,
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
        include: {
          initiator: {
            select: {
              id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
          receiver: {
            select: {
              id: true,
              name: true,
              email: true,
              profilePictureId: true,
            },
          },
        },
      },
    );

    if (!conversation) {
      throw new Error('Conversation not found or unauthorized');
    }

    // Load messages with pagination
    const [messages, totalMessages] = await Promise.all([
      this.prisma.client.privateMessage.findMany({
        where: { conversationId },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              profilePictureId: true,
            },
          },
          file: true,
          statuses: {
            where: { userId },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
      }),
      this.prisma.client.privateMessage.count({ where: { conversationId } }),
    ]);

    const otherParticipant =
      conversation.initiatorId === userId
        ? conversation.receiver
        : conversation.initiator;

    this.logger.log(
      `Loaded conversation ${conversationId} with ${messages.length} messages`,
    );

    const result = {
      conversation: {
        id: conversation.id,
        participant: otherParticipant,
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: messages.reverse(), // Reverse to show oldest first
      pagination: {
        page,
        limit,
        total: totalMessages,
        totalPages: Math.ceil(totalMessages / limit),
      },
    };

    client.emit(EventsEnum.CONVERSATION_RESPONSE, successResponse(result));
    return successResponse(result);
  }
}
