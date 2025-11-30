import { SocketSafe } from '@/common/decorators/socket-safe.decorator';
import { EventsEnum } from '@/common/enum/queue-events.enum';
import { successResponse } from '@/common/utils/response.util';
import { PrismaService } from '@/lib/prisma/prisma.service';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationStatus } from '@prisma';
import { Socket } from 'socket.io';
import { ChatGateway } from '../chat.gateway';
import {
  ConversationActionDto,
  InitConversationWithUserDto,
} from '../dto/conversation.dto';

@Injectable()
export class ConversationMutationService {
  private logger = new Logger(ConversationMutationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * Initiate or retrieve existing conversation with a user
   */
  @SocketSafe()
  async initiateConversationWithUser(
    client: Socket,
    dto: InitConversationWithUserDto,
  ) {
    const initiatorId = client.data.userId;
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

    const result = {
      id: conversation.id,
      participant: otherParticipant,
      lastMessage: conversation.lastMessage,
      status: conversation.status,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };

    client.emit(EventsEnum.SUCCESS, successResponse(result));

    // Notify the other participant if online
    const otherUserId = result.participant.id;
    this.chatGateway.emitToUserFirstSocket(
      otherUserId,
      EventsEnum.CONVERSATION_UPDATE,
      successResponse(result),
    );

    return successResponse(result);
  }

  /**
   * Delete a conversation
   */
  @SocketSafe()
  async deleteConversation(client: Socket, dto: ConversationActionDto) {
    const userId = client.data.userId;
    const { conversationId } = dto;

    this.logger.debug(
      `Deleting conversation ${conversationId} for user ${userId}`,
    );

    // Get conversation details before deleting to notify other participant
    const conversationData =
      await this.prisma.client.privateConversation.findFirst({
        where: {
          id: conversationId,
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
      });

    if (!conversationData) {
      throw new Error('Conversation not found or unauthorized');
    }

    const otherUserId =
      conversationData.initiatorId === userId
        ? conversationData.receiverId
        : conversationData.initiatorId;

    await this.prisma.client.privateConversation.delete({
      where: { id: conversationId },
    });

    this.logger.log(`Deleted conversation ${conversationId}`);

    client.emit(EventsEnum.SUCCESS, successResponse({ success: true }));

    // Notify the other participant if online
    this.chatGateway.emitToUserFirstSocket(
      otherUserId,
      EventsEnum.CONVERSATION_UPDATE,
      successResponse({
        conversationId: dto.conversationId,
        action: 'deleted',
      }),
    );

    return successResponse({ success: true });
  }

  /**
   * Archive a conversation
   */
  @SocketSafe()
  async archiveConversation(client: Socket, dto: ConversationActionDto) {
    const userId = client.data.userId;
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

    client.emit(EventsEnum.CONVERSATION_UPDATE, successResponse(conversation));
    return successResponse(conversation);
  }

  /**
   * Block a conversation
   */
  @SocketSafe()
  async blockConversation(client: Socket, dto: ConversationActionDto) {
    const userId = client.data.userId;
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

    client.emit(EventsEnum.CONVERSATION_UPDATE, successResponse(conversation));

    // Notify the other participant if online
    const otherUserId = conversation.participant.id;
    this.chatGateway.emitToUserFirstSocket(
      otherUserId,
      EventsEnum.CONVERSATION_UPDATE,
      successResponse({
        conversationId: dto.conversationId,
        action: 'blocked',
      }),
    );

    return successResponse(conversation);
  }

  /**
   * Unblock a conversation
   */
  @SocketSafe()
  async unblockConversation(client: Socket, dto: ConversationActionDto) {
    const userId = client.data.userId;
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

    client.emit(EventsEnum.CONVERSATION_UPDATE, successResponse(conversation));

    // Notify the other participant if online
    const otherUserId = conversation.participant.id;
    this.chatGateway.emitToUserFirstSocket(
      otherUserId,
      EventsEnum.CONVERSATION_UPDATE,
      successResponse({
        conversationId: dto.conversationId,
        action: 'unblocked',
      }),
    );

    return successResponse(conversation);
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
