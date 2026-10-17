import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service.js';
import { MessagingSettingsController } from './messaging-settings.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { MessagingSenders } from './senders.js';

@Global()
@Module({
  controllers: [NotificationsController, MessagingSettingsController],
  providers: [NotificationsService, MessagingSenders, EmailService],
  exports: [NotificationsService, MessagingSenders, EmailService],
})
export class NotificationsModule {}
