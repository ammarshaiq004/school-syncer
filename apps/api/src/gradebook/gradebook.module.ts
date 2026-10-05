import { Module } from '@nestjs/common';
import { GradebookController } from './gradebook.controller.js';

/** The gradebook matrix (AcademiaOS module D). Edits go through the exams and e-school endpoints. */
@Module({
  controllers: [GradebookController],
})
export class GradebookModule {}
