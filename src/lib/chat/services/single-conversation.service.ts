import { Injectable } from '@nestjs/common';
import { ConversationParticipantType, MessageType } from '@prisma/client';
import { EventsEnum } from '@project/common/enum/events.enum';
import { HandleError } from '@project/common/error/handle-error.decorator';
import { errorResponse, TResponse } from '@project/common/utils/response.util';
import { PrismaService } from '@project/lib/prisma/prisma.service';
import { Socket } from 'socket.io';
import {
  InitConversationWithClientDto,
  LoadSingleConversationDto,
} from '../dto/conversation.dto';

@Injectable()
export class SingleConversationService {
  constructor(private readonly prisma: PrismaService) {}

  @HandleError('Failed to load single conversation', 'ConversationService')
  async handleLoadSingleConversationByAdmin(
    client: Socket,
    payload: LoadSingleConversationDto,
  ): Promise<TResponse<any>> {
    const limit = payload?.limit ?? 10;
    const page = payload?.page && +payload.page > 0 ? +payload.page : 1;

    if (!payload.conversationId) {
      client.emit(
        EventsEnum.ERROR,
        errorResponse(null, 'Conversation ID is required'),
      );
      return errorResponse(null, 'Conversation ID is required');
    }

    // Load conversation with messages and calls
    const conversation = await this.prisma.privateConversation.findUnique({
      where: { id: payload.conversationId },
      include: {
        participants: { include: { user: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          include: { sender: true, file: true },
        },
        calls: {
          orderBy: { startedAt: 'desc' },
          include: { participants: { include: { user: true } } },
        },
      },
    });

    if (!conversation) {
      client.emit(
        EventsEnum.ERROR,
        errorResponse(null, 'Conversation not found'),
      );
      return errorResponse(null, 'Conversation not found');
    }

    // Transform participants
    const participants = conversation.participants.map((p) => ({
      id: p.user?.id,
      name: p.user?.name,
      avatarUrl: p.user?.avatarUrl,
      role: p.user?.role,
      email: p.user?.email,
    }));

    const userInParticipants = participants.find((p) => p.role === 'USER');

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
      isMine: m.senderId === client.data.userId,
      isSentByClient: m.senderId === userInParticipants?.id,
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
      isMine: c.initiatorId === client.data.userId,
      isSentByClient: c.initiatorId === userInParticipants?.id,
    }));

    // Merge and sort by time descending
    const conversationHistory = [
      ...normalizedMessages,
      ...normalizedCalls,
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Pagination
    const total = conversationHistory.length;
    const paginatedData = conversationHistory.slice(
      (page - 1) * limit,
      page * limit,
    );

    const outputData = {
      success: true,
      conversationId: conversation.id,
      participants,
      data: paginatedData,
      metadata: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
      message: 'Conversation loaded successfully',
    };

    // Emit to requester
    client.emit(EventsEnum.SINGLE_CONVERSATION, outputData);

    return outputData;
  }

  @HandleError('Failed to init conversation with client', 'ConversationService')
  async handleInitConversationWithClient(
    client: Socket,
    payload: InitConversationWithClientDto,
  ): Promise<TResponse<any>> {
    const adminId = client.data.userId;
    const clientId = payload.clientId;

    const [conversation] = await this.prisma.$transaction(async (tx) => {
      // First, try to find an existing conversation with client as a user participant
      const existingConversation = await tx.privateConversation.findFirst({
        where: {
          participants: {
            some: {
              userId: clientId,
              type: ConversationParticipantType.USER,
            },
          },
        },
        include: {
          participants: true,
        },
      });

      let conversation;
      if (existingConversation) {
        conversation = existingConversation;
        const adminParticipant = existingConversation.participants.find(
          (p) => p.userId === adminId,
        );
        if (!adminParticipant) {
          await tx.privateConversation.update({
            where: { id: existingConversation.id },
            data: {
              participants: {
                create: {
                  userId: adminId,
                  type: ConversationParticipantType.ADMIN_GROUP,
                },
              },
            },
          });
        }
      } else {
        conversation = await tx.privateConversation.create({
          data: {
            participants: {
              create: [
                {
                  userId: adminId,
                  type: ConversationParticipantType.ADMIN_GROUP,
                },
                {
                  userId: clientId,
                  type: ConversationParticipantType.USER,
                },
              ],
            },
          },
        });

        // Add a starter message for new conversation
        const firstMessage = await tx.privateMessage.create({
          data: {
            content: 'Conversation started',
            type: MessageType.TEXT,
            senderId: adminId,
            conversationId: conversation.id,
          },
        });

        await tx.privateConversation.update({
          where: { id: conversation.id },
          data: { lastMessageId: firstMessage.id },
        });
      }

      return [conversation];
    });

    // Reuse loader to keep output in sync
    return this.handleLoadSingleConversationByAdmin(client, {
      conversationId: conversation.id,
      page: 1,
      limit: 10,
    });
  }
}
