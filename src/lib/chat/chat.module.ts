import { Global, Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { CallService } from './services/call.service';
import { ConversationMutationService } from './services/conversation-mutation.service';
import { ConversationQueryService } from './services/conversation-query.service';
import { MessageService } from './services/message.service';
import { WebRTCService } from './services/webrtc.service';

@Global()
@Module({
  providers: [
    ChatGateway,
    MessageService,
    ConversationQueryService,
    ConversationMutationService,
    CallService,
    WebRTCService,
  ],
})
export class ChatModule {}
