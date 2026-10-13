import { Global, Module } from '@nestjs/common';
import { MessagingSettingsController } from './messaging-settings.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { MessagingSenders } from './senders.js';

@Global()
@Module({
  controllers: [NotificationsController, MessagingSettingsController],
  providers: [NotificationsService, MessagingSenders],
  exports: [NotificationsService, MessagingSenders],
})
export class NotificationsModule {}
