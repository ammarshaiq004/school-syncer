import { Module } from '@nestjs/common';
import { ElearningAssignmentsController } from './assignments/assignments.controller.js';
import { StudentAssignmentsController } from './assignments/student-assignments.controller.js';
import { TeachingScopeService } from './assignments/teaching-scope.service.js';
import { ElearningCoursesController } from './courses/courses.controller.js';
import { CoursesService } from './courses/courses.service.js';
import { StudentCoursesController } from './courses/student-courses.controller.js';
import { ElearningLiveController } from './live/live.controller.js';
import { LiveService } from './live/live.service.js';
import { StudentLiveController } from './live/student-live.controller.js';
import { QuizAttemptsService } from './quizzes/quiz-attempts.service.js';
import { ElearningQuizzesController } from './quizzes/quizzes.controller.js';
import { StudentQuizzesController } from './quizzes/student-quizzes.controller.js';

/**
 * E-school (SCHOOL-26): courses, live classes, assignments and quizzes, with
 * their student-facing endpoints. Each area adds its controllers here.
 */
@Module({
  controllers: [
    ElearningCoursesController,
    StudentCoursesController,
    ElearningLiveController,
    StudentLiveController,
    ElearningAssignmentsController,
    StudentAssignmentsController,
    ElearningQuizzesController,
    StudentQuizzesController,
  ],
  providers: [CoursesService, LiveService, TeachingScopeService, QuizAttemptsService],
  exports: [CoursesService],
})
export class ElearningModule {}
