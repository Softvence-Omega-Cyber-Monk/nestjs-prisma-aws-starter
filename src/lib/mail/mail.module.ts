import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { AuthMailService } from './services/auth-mail.service';

@Global()
@Module({
  providers: [MailService, AuthMailService],
  exports: [AuthMailService],
})
export class MailModule {}
