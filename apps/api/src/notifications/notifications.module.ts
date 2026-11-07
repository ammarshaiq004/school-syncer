import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { MessagingSettingsController } from './messaging-settings.controller.js';
import { MessageTemplatesController } from './message-templates.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { MessagingSenders } from './senders.js';
import { WhatsappInboxController, WhatsappWebhookController } from './whatsapp-inbox.controller.js';

@Global()
@Module({
  controllers: [NotificationsController, MessagingSettingsController, MessageTemplatesController, WhatsappInboxController, WhatsappWebhookController],
  providers: [NotificationsService, MessagingSenders, EmailService],
  exports: [NotificationsService, MessagingSenders, EmailService],
})
export class NotificationsModule {}
