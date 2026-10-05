import { Module } from '@nestjs/common';
import { ChatController, ParentChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

/** Parent-teacher chat (SCHOOL-25). */
@Module({
  controllers: [ChatController, ParentChatController],
  providers: [ChatService],
})
export class ChatModule {}
