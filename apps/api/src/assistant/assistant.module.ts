import { Module } from '@nestjs/common';
import { AssistantData } from './assistant-data.service.js';
import { AssistantModel } from './assistant-model.service.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';

/** AI assistant (SCHOOL-27). Claude is optional: see AssistantModel. */
@Module({
  controllers: [AssistantController],
  providers: [AssistantModel, AssistantData, AssistantService],
  exports: [AssistantModel],
})
export class AssistantModule {}
