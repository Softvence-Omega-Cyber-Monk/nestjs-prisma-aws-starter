import { PrismaService } from '@/lib/prisma/prisma.service';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationStatus } from '@prisma';
import { ChatGateway } from '../chat.gateway';
import {
  ConversationActionDto,
  InitConversationWithUserDto,
  LoadConversationsDto,
  LoadSingleConversationDto,
} from '../dto/conversation.dto';

@Injectable()
export class ConversationService {
  private logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Load paginated list of conversations for a user
   */
  async loadConversations(userId: string, dto: LoadConversationsDto) {
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

    return {
      conversations: transformedConversations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Load a single conversation with paginated messages
   */
  async loadSingleConversation(userId: string, dto: LoadSingleConversationDto) {
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

    return {
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
  }

  /**
   * Initiate or retrieve existing conversation with a user
   */
  async initiateConversationWithUser(
    initiatorId: string,
    dto: InitConversationWithUserDto,
  ) {
    const { userId: targetUserId } = dto;

    this.logger.debug(
      `Initiating conversation between ${initiatorId} and ${targetUserId}`,
    );

    if (initiatorId === targetUserId) {
      throw new Error('Cannot initiate conversation with yourself');
    }

    // Check if conversation already exists (bidirectional)
    let conversation = await this.prisma.client.privateConversation.findFirst({
      where: {
        OR: [
          { initiatorId, receiverId: targetUserId },
          { initiatorId: targetUserId, receiverId: initiatorId },
        ],
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
        lastMessage: {
          include: {
            sender: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (conversation) {
      this.logger.log(`Found existing conversation ${conversation.id}`);
    } else {
      // Verify target user exists
      const targetUser = await this.prisma.client.user.findUnique({
        where: { id: targetUserId },
      });

      if (!targetUser) {
        throw new Error('Target user not found');
      }

      // Create new conversation
      conversation = await this.prisma.client.privateConversation.create({
        data: {
          initiatorId,
          receiverId: targetUserId,
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
          lastMessage: {
            include: {
              sender: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      this.logger.log(`Created new conversation ${conversation.id}`);
    }

    const otherParticipant =
      conversation.initiatorId === initiatorId
        ? conversation.receiver
        : conversation.initiator;

    return {
      id: conversation.id,
      participant: otherParticipant,
      lastMessage: conversation.lastMessage,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(userId: string, dto: ConversationActionDto) {
    const { conversationId } = dto;

    this.logger.debug(
      `Deleting conversation ${conversationId} for user ${userId}`,
    );

    // Verify user is a participant
    const conversation = await this.prisma.client.privateConversation.findFirst(
      {
        where: {
          id: conversationId,
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
      },
    );

    if (!conversation) {
      throw new Error('Conversation not found or unauthorized');
    }

    await this.prisma.client.privateConversation.delete({
      where: { id: conversationId },
    });

    this.logger.log(`Deleted conversation ${conversationId}`);

    return { success: true };
  }

  /**
   * Archive a conversation
   */
  async archiveConversation(userId: string, dto: ConversationActionDto) {
    const { conversationId } = dto;

    this.logger.debug(
      `Archiving conversation ${conversationId} for user ${userId}`,
    );

    const conversation = await this.updateConversationStatus(
      userId,
      conversationId,
      ConversationStatus.ARCHIVED,
    );

    this.logger.log(`Archived conversation ${conversationId}`);

    return conversation;
  }

  /**
   * Block a conversation
   */
  async blockConversation(userId: string, dto: ConversationActionDto) {
    const { conversationId } = dto;

    this.logger.debug(
      `Blocking conversation ${conversationId} for user ${userId}`,
    );

    const conversation = await this.updateConversationStatus(
      userId,
      conversationId,
      ConversationStatus.BLOCKED,
    );

    this.logger.log(`Blocked conversation ${conversationId}`);

    return conversation;
  }

  /**
   * Unblock a conversation
   */
  async unblockConversation(userId: string, dto: ConversationActionDto) {
    const { conversationId } = dto;

    this.logger.debug(
      `Unblocking conversation ${conversationId} for user ${userId}`,
    );

    const conversation = await this.updateConversationStatus(
      userId,
      conversationId,
      ConversationStatus.ACTIVE,
    );

    this.logger.log(`Unblocked conversation ${conversationId}`);

    return conversation;
  }

  /**
   * Helper method to update conversation status
   */
  private async updateConversationStatus(
    userId: string,
    conversationId: string,
    status: ConversationStatus,
  ) {
    // Verify user is a participant
    const conversation = await this.prisma.client.privateConversation.findFirst(
      {
        where: {
          id: conversationId,
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
      },
    );

    if (!conversation) {
      throw new Error('Conversation not found or unauthorized');
    }

    const updated = await this.prisma.client.privateConversation.update({
      where: { id: conversationId },
      data: { status },
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
    });

    const otherParticipant =
      updated.initiatorId === userId ? updated.receiver : updated.initiator;

    return {
      id: updated.id,
      participant: otherParticipant,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
