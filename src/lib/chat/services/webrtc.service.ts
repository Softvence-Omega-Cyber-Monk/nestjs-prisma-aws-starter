import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { EventsEnum } from '@project/common/enum/events.enum';
import { HandleError } from '@project/common/error/handle-error.decorator';
import {
  successResponse,
  TResponse,
} from '@project/common/utils/response.util';
import { PrismaService } from '@project/lib/prisma/prisma.service';
import { Socket } from 'socket.io';
import { ChatGateway } from '../chat.gateway';
import {
  RTCAnswerDto,
  RTCIceCandidateDto,
  RTCOfferDto,
} from '../dto/webrtc.dto';
import { CallService } from './call.service';

@Injectable()
export class WebRTCService {
  private readonly logger = new Logger(WebRTCService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    private readonly callService: CallService,
  ) {
    this.logger.log('WebRTCService initialized');
  }

  /** -------------------- Forward Offer -------------------- */
  @HandleError('Failed to forward offer', 'WebRTCService')
  async forwardOffer(
    client: Socket,
    payload: RTCOfferDto,
  ): Promise<TResponse<any>> {
    this.logger.log(`Forwarding RTC offer for call: ${payload.callId}`);

    const from = client.data.userId;
    if (!from) {
      this.logger.warn('Unauthorized offer forward attempt - no userId');
      return this.chatGateway.emitError(client, 'Unauthorized');
    }

    this.logger.debug(
      `Offer from user ${from}, socket: ${client.id}, target: ${payload.to || 'auto'}`,
    );

    // forward only to the other party (one-to-one)
    const call = await this.prisma.privateCall.findUnique({
      where: { id: payload.callId },
      include: { participants: true },
    });

    if (!call) {
      this.logger.warn(
        `Call not found: ${payload.callId} for offer from ${from}`,
      );
      return this.chatGateway.emitError(client, 'Call not found');
    }

    this.logger.debug(
      `Call found: ${call.id}, status: ${call.status}, participants: ${call.participants.length}`,
    );

    const other = call.participants.find((p) => p.userId !== from);
    if (!other?.userId) {
      this.logger.warn(
        `No recipient found in call ${payload.callId} (sender: ${from})`,
      );
      return this.chatGateway.emitError(client, 'Recipient not found');
    }

    this.logger.debug(`Target recipient identified: ${other.userId}`);

    const target = this.callService.findTargetSocketForRecipient(
      call.id,
      other.userId,
      payload.to,
      client.id,
    );

    if (!target) {
      this.logger.warn(
        `Recipient ${other.userId} not available for call ${payload.callId}`,
      );
      return this.chatGateway.emitError(client, 'Recipient not available');
    }

    this.logger.log(
      `Forwarding offer to recipient ${other.userId} on socket ${target}`,
    );

    this.chatGateway.emitToSocketId(
      target,
      EventsEnum.RTC_OFFER,
      successResponse({ callId: call.id, sdp: payload.sdp, from }),
    );

    this.logger.debug(`Offer successfully forwarded to ${other.userId}`);

    // record mapping prefer sender's socket for call
    this.callService['ensureCallSocketEntry'](call.id).set(from, client.id);
    this.logger.debug(
      `Updated socket mapping for call ${call.id}: ${from} -> ${client.id}`,
    );

    this.logger.log(`Offer forwarded successfully for call ${payload.callId}`);
    return successResponse(payload, 'Offer forwarded');
  }

  /** -------------------- Forward Answer -------------------- */
  @HandleError('Failed to forward answer', 'WebRTCService')
  async forwardAnswer(
    client: Socket,
    payload: RTCAnswerDto,
  ): Promise<TResponse<any>> {
    this.logger.log(`Forwarding RTC answer for call: ${payload.callId}`);

    const from = client.data.userId;
    if (!from) {
      this.logger.warn('Unauthorized answer forward attempt - no userId');
      return this.chatGateway.emitError(client, 'Unauthorized');
    }

    this.logger.debug(
      `Answer from user ${from}, socket: ${client.id}, target: ${payload.to || 'auto'}`,
    );

    const call = await this.prisma.privateCall.findUnique({
      where: { id: payload.callId },
      include: { participants: true },
    });

    if (!call) {
      this.logger.warn(
        `Call not found: ${payload.callId} for answer from ${from}`,
      );
      return this.chatGateway.emitError(client, 'Call not found');
    }

    this.logger.debug(
      `Call found: ${call.id}, status: ${call.status}, participants: ${call.participants.length}`,
    );

    const other = call.participants.find((p) => p.userId !== from);
    if (!other?.userId) {
      this.logger.warn(
        `No recipient found in call ${payload.callId} (sender: ${from})`,
      );
      return this.chatGateway.emitError(client, 'Recipient not found');
    }

    this.logger.debug(`Target recipient identified: ${other.userId}`);

    const target = this.callService.findTargetSocketForRecipient(
      call.id,
      other.userId,
      payload.to,
      client.id,
    );

    if (!target) {
      this.logger.warn(
        `Recipient ${other.userId} not available for call ${payload.callId}`,
      );
      return this.chatGateway.emitError(client, 'Recipient not available');
    }

    this.logger.log(
      `Forwarding answer to recipient ${other.userId} on socket ${target}`,
    );

    this.chatGateway.emitToSocketId(
      target,
      EventsEnum.RTC_ANSWER,
      successResponse({ callId: call.id, sdp: payload.sdp, from }),
    );

    this.logger.debug(`Answer successfully forwarded to ${other.userId}`);

    this.callService['ensureCallSocketEntry'](call.id).set(from, client.id);
    this.logger.debug(
      `Updated socket mapping for call ${call.id}: ${from} -> ${client.id}`,
    );

    this.logger.log(`Answer forwarded successfully for call ${payload.callId}`);
    return successResponse(payload, 'Answer forwarded');
  }

  /** -------------------- Forward ICE Candidate -------------------- */
  @HandleError('Failed to forward candidate', 'WebRTCService')
  async forwardCandidate(
    client: Socket,
    payload: RTCIceCandidateDto,
  ): Promise<TResponse<any>> {
    this.logger.log(
      `Forwarding ICE candidate for call: ${payload.callId}, sdpMid: ${payload.sdpMid}, sdpMLineIndex: ${payload.sdpMLineIndex}`,
    );

    const from = client.data.userId;
    if (!from) {
      this.logger.warn('Unauthorized candidate forward attempt - no userId');
      return this.chatGateway.emitError(client, 'Unauthorized');
    }

    this.logger.debug(
      `Candidate from user ${from}, socket: ${client.id}, target: ${payload.to || 'auto'}`,
    );

    const call = await this.prisma.privateCall.findUnique({
      where: { id: payload.callId },
      include: { participants: true },
    });

    if (!call) {
      this.logger.warn(
        `Call not found: ${payload.callId} for candidate from ${from}`,
      );
      return this.chatGateway.emitError(client, 'Call not found');
    }

    this.logger.debug(
      `Call found: ${call.id}, status: ${call.status}, participants: ${call.participants.length}`,
    );

    const other = call.participants.find((p) => p.userId !== from);
    if (!other?.userId) {
      this.logger.warn(
        `No recipient found in call ${payload.callId} (sender: ${from})`,
      );
      return this.chatGateway.emitError(client, 'Recipient not found');
    }

    this.logger.debug(`Target recipient identified: ${other.userId}`);

    const target = this.callService.findTargetSocketForRecipient(
      call.id,
      other.userId,
      payload.to,
      client.id,
    );

    if (!target) {
      this.logger.warn(
        `Recipient ${other.userId} not available for call ${payload.callId}`,
      );
      return this.chatGateway.emitError(client, 'Recipient not available');
    }

    this.logger.log(
      `Forwarding ICE candidate to recipient ${other.userId} on socket ${target}`,
    );

    this.chatGateway.emitToSocketId(
      target,
      EventsEnum.RTC_ICE_CANDIDATE,
      successResponse({
        callId: call.id,
        candidate: payload.candidate,
        sdpMid: payload.sdpMid,
        sdpMLineIndex: payload.sdpMLineIndex,
        from,
      }),
    );

    this.logger.debug(
      `ICE candidate successfully forwarded to ${other.userId}`,
    );

    this.callService['ensureCallSocketEntry'](call.id).set(from, client.id);
    this.logger.debug(
      `Updated socket mapping for call ${call.id}: ${from} -> ${client.id}`,
    );

    this.logger.log(
      `ICE candidate forwarded successfully for call ${payload.callId}`,
    );
    return successResponse(payload, 'Candidate forwarded');
  }
}
