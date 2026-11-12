import { Module } from '@nestjs/common';
import { LessonPlansController } from './lesson-plans.controller.js';
import { SyllabusController } from './syllabus.controller.js';

/** Teachers' weekly lesson plans and syllabus progress and the setup roles' review queue. */
@Module({
  controllers: [LessonPlansController, SyllabusController],
})
export class LessonPlansModule {}
