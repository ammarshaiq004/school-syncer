import { Module } from '@nestjs/common';
import { LessonPlansController } from './lesson-plans.controller.js';

/** Teachers' weekly lesson plans and the setup roles' review queue. */
@Module({
  controllers: [LessonPlansController],
})
export class LessonPlansModule {}
