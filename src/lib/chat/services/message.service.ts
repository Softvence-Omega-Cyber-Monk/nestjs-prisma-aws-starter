import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  ConversationParticipantType,
  MessageDeliveryStatus,
  MessageType,
} from '@prisma/client';
import { HandleError } from '@project/common/error/handle-error.decorator';
import {
  successResponse,
  TResponse,
} from '@project/common/utils/response.util';
import { PrismaService } from '@project/lib/prisma/prisma.service';
import { QUEUE_EVENTS } from '@project/lib/queue/interface/queue-events';
import { Socket } from 'socket.io';
import { EventsEnum } from '../../../common/enum/events.enum';
import { ChatGateway } from '../chat.gateway';
import { AdminMessageDto, ClientMessageDto } from '../dto/message.dto';

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * =======================
   * Public API
   * =======================
   */
  @HandleError('Failed to send message to admin(s)', 'MessageService')
  async sendMessageFromClient(
    client: Socket,
    payload: ClientMessageDto,
  ): Promise<TResponse<any>> {
    const senderId = client.data.userId;
    if (!senderId) return this.chatGateway.emitError(client, 'Unauthorized');

    const admins = await this.chatGateway.getAllAdminParticipants();

    // Find or create conversation
    let conversation = await this.prisma.privateConversation.findFirst({
      where: {
        participants: {
          some: {
            userId: senderId,
            type: ConversationParticipantType.USER,
          },
        },
      },
      include: { participants: true },
    });

    if (!conversation) {
      conversation = await this.prisma.privateConversation.create({
        data: {
          participants: {
            create: [
              { userId: senderId, type: ConversationParticipantType.USER },
            ],
          },
        },
        include: { participants: true },
      });
    }

    const message = await this.createMessage(
      conversation.id,
      senderId,
      payload.content,
      payload.type,
      payload.fileId,
    );

    await this.updateConversationAndStatuses(conversation.id, message.id, [
      ...conversation.participants.map((p) => p.userId!),
    ]);

    const formattedMessage = this.chatGateway.formatMessageForClient(
      message,
      senderId,
      'MESSAGE',
    );

    // Notify admins + client
    this.emitMessageToAdmins(
      admins,
      EventsEnum.NEW_MESSAGE,
      message,
      'New message received from client',
    );

    this.emitMessageToClient(
      client.data.userId,
      EventsEnum.NEW_MESSAGE,
      message,
      'New message received from client',
    );

    return successResponse(
      { conversationId: conversation.id, message: formattedMessage },
      'Message sent successfully',
    );
  }

  @HandleError('Failed to send message to client', 'MessageService')
  async sendMessageFromAdmin(
    client: Socket,
    payload: AdminMessageDto,
  ): Promise<TResponse<any>> {
    const senderId = client.data.userId;
    if (!senderId) return this.chatGateway.emitError(client, 'Unauthorized');

    const conversation = await this.prisma.privateConversation.findFirst({
      where: {
        participants: {
          some: {
            userId: payload.clientId,
            type: ConversationParticipantType.USER,
          },
        },
      },
      include: { participants: true },
    });
    if (!conversation)
      return this.chatGateway.emitError(client, 'Conversation not found');

    const clientId = conversation.participants.find(
      (p) => p.type === ConversationParticipantType.USER,
    )?.userId;
    if (!clientId)
      return this.chatGateway.emitError(
        client,
        'Client not found in conversation',
      );

    const message = await this.createMessage(
      conversation.id,
      senderId,
      payload.content,
      payload.type,
      payload.fileId,
    );

    // Ensure admin is part of conversation
    const newAdmin =
      conversation.participants.some((p) => p.userId === senderId) === false
        ? [{ userId: senderId, type: ConversationParticipantType.ADMIN_GROUP }]
        : [];

    const participantIds = [
      ...conversation.participants.map((p) => p.userId!),
      ...newAdmin.map((p) => p.userId!),
    ];

    await this.updateConversationAndStatuses(
      conversation.id,
      message.id,
      participantIds,
      newAdmin,
    );

    // Store the message as notification
    if (payload.type === MessageType.TEXT && payload.content) {
      await this.prisma.notification.create({
        data: {
          users: {
            createMany: {
              data: participantIds.map((id) => ({ userId: id })),
            },
          },
          title: 'New message from trainer',
          message: payload.content,
          type: QUEUE_EVENTS.MESSAGES,
          meta: {
            conversationId: conversation.id,
            messageId: message.id,
          },
        },
      });
    }

    const formattedMessage = this.chatGateway.formatMessageForClient(
      message,
      clientId,
      'MESSAGE',
    );

    // Notify client + admins
    this.emitMessageToClient(
      clientId,
      EventsEnum.NEW_MESSAGE,
      message,
      'New message from admin',
    );

    const admins = await this.chatGateway.getAllAdminParticipants();

    this.emitMessageToAdmins(
      admins,
      EventsEnum.NEW_MESSAGE,
      message,
      'New message from admin',
    );

    // If client online → mark delivered
    if (this.chatGateway.isOnline(clientId)) {
      this.emitDeliveryStatus(admins, clientId, message.id, senderId);
    }

    return successResponse(
      { conversationId: conversation.id, message: formattedMessage },
      'Message sent successfully',
    );
  }

  /**
   * =======================
   * Helpers
   * =======================
   */
  private async createMessage(
    conversationId: string,
    senderId: string,
    content: string = '',
    type: MessageType = 'TEXT',
    fileId?: string,
  ) {
    return this.prisma.privateMessage.create({
      data: { conversationId, senderId, content, type, fileId },
      include: {
        file: true,
        sender: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  private async updateConversationAndStatuses(
    conversationId: string,
    messageId: string,
    participantIds: string[],
    newParticipants: {
      userId: string;
      type: ConversationParticipantType;
    }[] = [],
  ) {
    await this.prisma.$transaction([
      this.prisma.privateConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageId: messageId,
          participants: { create: newParticipants },
        },
      }),
      ...participantIds.map((id) =>
        this.prisma.privateMessageStatus.create({
          data: { messageId, userId: id },
        }),
      ),
    ]);
  }

  private emitDeliveryStatus(
    admins: { userId: string }[],
    clientId: string,
    messageId: string,
    senderId: string,
  ) {
    const payload = {
      messageId,
      userId: senderId,
      status: MessageDeliveryStatus.DELIVERED,
    };

    this.chatGateway.server
      .to(clientId)
      .emit(
        EventsEnum.UPDATE_MESSAGE_STATUS,
        successResponse(payload, 'Your message has been delivered'),
      );
    this.emitMessageToAdmins(
      admins,
      EventsEnum.UPDATE_MESSAGE_STATUS,
      payload,
      'Your message has been delivered',
    );
  }

  public emitMessageToAdmins(
    admins: { userId: string }[],
    event: EventsEnum,
    message: any,
    messageText: string,
  ) {
    admins.forEach((admin) => {
      const formatted = this.chatGateway.formatMessageForClient(
        message,
        admin.userId,
        'MESSAGE',
      );
      this.chatGateway.server
        .to(admin.userId)
        .emit(event, successResponse(formatted, messageText));
    });
  }

  public emitMessageToClient(
    clientId: string,
    event: EventsEnum,
    message: any,
    messageText: string,
  ) {
    const formatted = this.chatGateway.formatMessageForClient(
      message,
      clientId,
      'MESSAGE',
    );
    this.chatGateway.server
      .to(clientId)
      .emit(event, successResponse(formatted, messageText));
  }
}
