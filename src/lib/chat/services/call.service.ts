import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import {
  CallParticipantStatus,
  CallStatus,
  CallType as PrismaCallType,
} from '@prisma/client';
import { EventsEnum } from '@project/common/enum/events.enum';
import { HandleError } from '@project/common/error/handle-error.decorator';
import {
  successResponse,
  TResponse,
} from '@project/common/utils/response.util';
import { PrismaService } from '@project/lib/prisma/prisma.service';
import { Socket } from 'socket.io';
import { ChatGateway } from '../chat.gateway';
import { CallActionDto, InitiateCallDto } from '../dto/call.dto';

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  // callId -> ( userId -> socketId )
  private callSocketMap = new Map<string, Map<string, string>>();

  // short-lived ring timers
  private ringTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {
    this.logger.log('CallService initialized');
  }

  /** -------------------- Initiate (ADMIN -> USER) -------------------- */
  @HandleError('Failed to initiate call', 'CallService')
  async initiateCall(
    client: Socket,
    dto: InitiateCallDto,
  ): Promise<TResponse<any>> {
    this.logger.log(
      `Initiating call for conversationId: ${dto.conversationId}, type: ${dto.type}`,
    );

    const callerId = client.data.userId;
    if (!callerId) {
      this.logger.warn('Unauthorized call initiation attempt - no userId');
      return this.chatGateway.emitError(client, 'Unauthorized');
    }

    this.logger.debug(`Caller identified: ${callerId}`);

    const conversation = await this.prisma.privateConversation.findUnique({
      where: { id: dto.conversationId },
      include: { participants: true },
    });

    if (!conversation) {
      this.logger.warn(
        `Conversation not found: ${dto.conversationId} for caller: ${callerId}`,
      );
      return this.chatGateway.emitError(client, 'Conversation not found');
    }

    this.logger.debug(
      `Conversation found with ${conversation.participants.length} participants`,
    );

    // caller must be an ADMIN_GROUP participant
    const callerParticipant = conversation.participants.find(
      (p) => p.userId === callerId && p.type === 'ADMIN_GROUP',
    );

    if (!callerParticipant) {
      this.logger.warn(
        `Non-admin user ${callerId} attempted to initiate call in conversation ${dto.conversationId}`,
      );
      return this.chatGateway.emitError(
        client,
        'Only admins may initiate calls',
      );
    }

    this.logger.debug(`Admin caller verified: ${callerId}`);

    // pick the single user participant (one-to-one)
    const userParticipant = conversation.participants.find(
      (p) => p.type === 'USER' && p.userId,
    );

    if (!userParticipant) {
      this.logger.warn(
        `No user participant found in conversation ${dto.conversationId}`,
      );
      return this.chatGateway.emitError(
        client,
        'No user in conversation to call',
      );
    }

    this.logger.debug(`Target user identified: ${userParticipant.userId}`);

    // create call with two participant records: initiator joined, target missed
    const call = await this.prisma.privateCall.create({
      data: {
        conversationId: dto.conversationId,
        initiatorId: callerId,
        type: dto.type as PrismaCallType,
        status: CallStatus.INITIATED,
        participants: {
          create: [
            {
              userId: callerId,
              status: CallParticipantStatus.JOINED,
            },
            {
              userId: userParticipant.userId!,
              status: CallParticipantStatus.MISSED,
            },
          ],
        },
      },
      include: { participants: true },
    });

    this.logger.log(
      `Call created: ${call.id} - initiator: ${callerId}, target: ${userParticipant.userId}`,
    );

    // store socket mapping preferring initiator socket
    const map = new Map<string, string>();
    map.set(callerId, client.id);
    this.callSocketMap.set(call.id, map);

    this.logger.debug(
      `Socket mapping stored for call ${call.id}: ${callerId} -> ${client.id}`,
    );

    // notify the target user (single recipient)
    const targetSocket = this.findTargetSocketForRecipient(
      call.id,
      userParticipant.userId!,
    );

    if (targetSocket) {
      this.logger.log(
        `Notifying target user ${userParticipant.userId} on socket ${targetSocket}`,
      );
      this.chatGateway.emitToSocketId(
        targetSocket,
        EventsEnum.CALL_INCOMING,
        successResponse({ call, from: callerId }),
      );
    } else {
      this.logger.warn(
        `Target user ${userParticipant.userId} has no active socket`,
      );
    }

    // start ring timeout (mark missed if nobody joins)
    this.setRingTimeout(call.id, 30_000);

    this.logger.log(`Call ${call.id} initiated successfully`);
    return successResponse(call, 'Call initiated');
  }

  /** -------------------- Accept (USER accepts) -------------------- */
  @HandleError('Failed to accept call', 'CallService')
  async acceptCall(
    client: Socket,
    dto: CallActionDto,
  ): Promise<TResponse<any>> {
    this.logger.log(`Accepting call: ${dto.callId}`);

    const userId = client.data.userId;
    if (!userId) {
      this.logger.warn('Unauthorized accept attempt - no userId');
      return this.chatGateway.emitError(client, 'Unauthorized');
    }

    this.logger.debug(`User accepting call: ${userId}`);

    // validate call exists and user is a participant
    const call = await this.prisma.privateCall.findUnique({
      where: { id: dto.callId },
      include: { participants: true },
    });

    if (!call) {
      this.logger.warn(`Call not found: ${dto.callId} for user: ${userId}`);
      return this.chatGateway.emitError(client, 'Call not found');
    }

    this.logger.debug(`Call found: ${dto.callId}, status: ${call.status}`);

    // mark participant as JOINED (create if missing)
    const existing = call.participants.find((p) => p.userId === userId);

    if (existing) {
      this.logger.debug(
        `Updating existing participant ${existing.id} to JOINED`,
      );
      await this.prisma.privateCallParticipant.update({
        where: { id: existing.id },
        data: { status: CallParticipantStatus.JOINED, joinedAt: new Date() },
      });
    } else {
      this.logger.debug(`Creating new participant record for ${userId}`);
      await this.prisma.privateCallParticipant.create({
        data: {
          callId: dto.callId,
          userId,
          status: CallParticipantStatus.JOINED,
          joinedAt: new Date(),
        },
      });
    }

    // move call -> ONGOING if still INITIATED
    if (call.status === CallStatus.INITIATED) {
      this.logger.log(`Moving call ${dto.callId} to ONGOING status`);
      await this.prisma.privateCall.update({
        where: { id: dto.callId },
        data: { status: CallStatus.ONGOING, startedAt: new Date() },
      });
    }

    // record socket mapping for deterministic routing
    this.ensureCallSocketEntry(dto.callId).set(userId, client.id);
    this.logger.debug(
      `Socket mapping updated for call ${dto.callId}: ${userId} -> ${client.id}`,
    );

    // clear ring timeout
    this.clearRingTimeout(dto.callId);

    // notify initiator (admin) that user accepted
    const initiator = call.participants.find((p) => p.userId !== userId);
    if (initiator?.userId) {
      const targetSock = this.findTargetSocketForRecipient(
        call.id,
        initiator.userId,
      );
      if (targetSock) {
        this.logger.log(
          `Notifying initiator ${initiator.userId} that call was accepted`,
        );
        this.chatGateway.emitToSocketId(
          targetSock,
          EventsEnum.CALL_ACCEPT,
          successResponse({ callId: dto.callId, userId }),
        );
      } else {
        this.logger.warn(
          `Initiator ${initiator.userId} has no active socket to notify`,
        );
      }
    }

    this.logger.log(`Call ${dto.callId} accepted by user ${userId}`);
    return successResponse({ callId: dto.callId, userId }, 'Call accepted');
  }

  /** -------------------- Reject (USER rejects) -------------------- */
  @HandleError('Failed to reject call', 'CallService')
  async rejectCall(
    client: Socket,
    dto: CallActionDto,
  ): Promise<TResponse<any>> {
    this.logger.log(`Rejecting call: ${dto.callId}`);

    const userId = client.data.userId;
    if (!userId) {
      this.logger.warn('Unauthorized reject attempt - no userId');
      return this.chatGateway.emitError(client, 'Unauthorized');
    }

    this.logger.debug(`User rejecting call: ${userId}`);

    const call = await this.prisma.privateCall.findUnique({
      where: { id: dto.callId },
      include: { participants: true },
    });

    if (!call) {
      this.logger.warn(`Call not found: ${dto.callId} for user: ${userId}`);
      return this.chatGateway.emitError(client, 'Call not found');
    }

    this.logger.debug(`Call found: ${dto.callId}, marking as rejected`);

    // mark this participant missed/rejected
    await this.prisma.privateCallParticipant.updateMany({
      where: { callId: dto.callId, userId },
      data: { status: CallParticipantStatus.MISSED, leftAt: new Date() },
    });

    this.logger.debug(`Participant ${userId} marked as MISSED`);

    // mark call missed and notify initiator
    await this.prisma.privateCall.update({
      where: { id: dto.callId },
      data: { status: CallStatus.MISSED, endedAt: new Date() },
    });

    this.logger.log(`Call ${dto.callId} marked as MISSED`);

    this.clearRingTimeout(dto.callId);
    this.callSocketMap.delete(dto.callId);

    this.logger.debug(`Cleaned up resources for call ${dto.callId}`);

    const initiator = call.participants.find((p) => p.userId !== userId);
    if (initiator?.userId) {
      const targetSock = this.findTargetSocketForRecipient(
        call.id,
        initiator.userId,
      );
      if (targetSock) {
        this.logger.log(
          `Notifying initiator ${initiator.userId} that call was rejected`,
        );
        this.chatGateway.emitToSocketId(
          targetSock,
          EventsEnum.CALL_MISSED,
          successResponse({ callId: dto.callId, by: userId }),
        );
      } else {
        this.logger.warn(
          `Initiator ${initiator.userId} has no active socket to notify`,
        );
      }
    }

    this.logger.log(`Call ${dto.callId} rejected by user ${userId}`);
    return successResponse({ callId: dto.callId, userId }, 'Call rejected');
  }

  /** -------------------- End call (either side) -------------------- */
  @HandleError('Failed to end call', 'CallService')
  async endCall(client: Socket, dto: CallActionDto): Promise<TResponse<any>> {
    this.logger.log(`Ending call: ${dto.callId}`);

    const userId = client.data.userId;
    this.logger.debug(`End call requested by user: ${userId}`);

    // mark ended and notify both sides (if present)
    const call = await this.prisma.privateCall.update({
      where: { id: dto.callId },
      data: { status: CallStatus.ENDED, endedAt: new Date() },
      include: { participants: true },
    });

    this.logger.log(`Call ${dto.callId} marked as ENDED`);

    this.clearRingTimeout(dto.callId);

    // notify remaining participants
    let notifiedCount = 0;
    for (const p of call.participants) {
      if (!p.userId) continue;
      const sock = this.findTargetSocketForRecipient(call.id, p.userId);
      if (sock) {
        this.logger.debug(`Notifying participant ${p.userId} of call end`);
        this.chatGateway.emitToSocketId(
          sock,
          EventsEnum.CALL_END,
          successResponse({ callId: dto.callId }),
        );
        notifiedCount++;
      }
    }

    this.logger.log(
      `Notified ${notifiedCount}/${call.participants.length} participants of call end`,
    );

    this.callSocketMap.delete(dto.callId);
    this.logger.debug(`Cleaned up resources for call ${dto.callId}`);

    this.logger.log(`Call ${dto.callId} ended successfully`);
    return successResponse({ callId: dto.callId }, 'Call ended');
  }

  /** -------------------- Helpers -------------------- */
  private ensureCallSocketEntry(callId: string) {
    if (!this.callSocketMap.has(callId)) {
      this.logger.debug(`Creating new socket map entry for call ${callId}`);
      this.callSocketMap.set(callId, new Map());
    }
    return this.callSocketMap.get(callId)!;
  }

  findTargetSocketForRecipient(
    callId: string,
    recipientUserId: string,
    // allow client to hint socket/userId; prefer recorded socket then active sockets
    payloadTo?: string,
    excludeSocketId?: string,
  ): string | null {
    this.logger.debug(
      `Finding target socket for recipient ${recipientUserId} in call ${callId}`,
    );

    // prefer explicit socket id if it matches active sockets
    if (payloadTo && typeof payloadTo === 'string') {
      this.logger.debug(`Checking explicit socket hint: ${payloadTo}`);
      const active = this.chatGateway.getActiveSocketIdsForUser(
        recipientUserId,
        excludeSocketId,
      );
      if (active.includes(payloadTo)) {
        this.logger.debug(`Using hinted socket: ${payloadTo}`);
        return payloadTo;
      }
    }

    // prefer recorded socket for this call
    const map = this.callSocketMap.get(callId);
    if (map) {
      const recorded = map.get(recipientUserId);
      if (recorded && recorded !== excludeSocketId) {
        this.logger.debug(`Using recorded socket: ${recorded}`);
        return recorded;
      }
    }

    // fallback to first active socket for user
    const active = this.chatGateway.getActiveSocketIdsForUser(
      recipientUserId,
      excludeSocketId,
    );
    if (active.length) {
      this.logger.debug(`Using first active socket: ${active[0]}`);
      return active[0];
    }

    this.logger.warn(`No socket found for recipient ${recipientUserId}`);
    return null;
  }

  private setRingTimeout(callId: string, ms = 30_000) {
    this.logger.debug(`Setting ring timeout for call ${callId}: ${ms}ms`);
    this.clearRingTimeout(callId);

    const t = setTimeout(async () => {
      try {
        this.logger.log(`Call ${callId} ring timeout -> marking missed`);
        await this.prisma.privateCall.update({
          where: { id: callId },
          data: { status: CallStatus.MISSED, endedAt: new Date() },
        });
        this.callSocketMap.delete(callId);
        this.logger.log(`Call ${callId} marked as missed due to timeout`);
      } catch (err) {
        this.logger.error(
          `Failed to mark call ${callId} as missed`,
          err as any,
        );
      } finally {
        this.clearRingTimeout(callId);
      }
    }, ms);

    this.ringTimeouts.set(callId, t);
  }

  private clearRingTimeout(callId: string) {
    const t = this.ringTimeouts.get(callId);
    if (t) {
      this.logger.debug(`Clearing ring timeout for call ${callId}`);
      clearTimeout(t);
      this.ringTimeouts.delete(callId);
    }
  }
}
