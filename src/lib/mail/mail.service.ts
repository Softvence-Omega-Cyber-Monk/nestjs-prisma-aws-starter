import { ENVEnum } from '@/common/enum/env.enum';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private fromEmail: string;

  constructor(private configService: ConfigService) {
    const user = this.configService.getOrThrow<string>(ENVEnum.MAIL_USER);
    const pass = this.configService.getOrThrow<string>(ENVEnum.MAIL_PASS);

    this.fromEmail = user;
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }

  public async sendMail({
    to,
    subject,
    html,
    text,
  }: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<nodemailer.SentMessageInfo> {
    return this.transporter.sendMail({
      from: `"No Reply" <${this.fromEmail}>`,
      to,
      subject,
      html,
      text,
    });
  }
}
