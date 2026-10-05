import { Module } from '@nestjs/common';
import { ElearningAssignmentsController } from './assignments/assignments.controller.js';
import { StudentAssignmentsController } from './assignments/student-assignments.controller.js';
import { TeachingScopeService } from './assignments/teaching-scope.service.js';
import { ElearningCoursesController } from './courses/courses.controller.js';
import { CoursesService } from './courses/courses.service.js';
import { StudentCoursesController } from './courses/student-courses.controller.js';
import { FilesController } from './files/files.controller.js';
import { FilesService } from './files/files.service.js';
import { storageProvider } from './files/storage/storage.provider.js';
import { ElearningLiveController } from './live/live.controller.js';
import { LiveService } from './live/live.service.js';
import { StudentLiveController } from './live/student-live.controller.js';
import { QuizAttemptsService } from './quizzes/quiz-attempts.service.js';
import { ElearningQuizzesController } from './quizzes/quizzes.controller.js';
import { StudentQuizzesController } from './quizzes/student-quizzes.controller.js';

/**
 * E-school (SCHOOL-26): courses, live classes, assignments and quizzes, with
 * their student-facing endpoints, and uploaded files for lessons, assignments
 * and submissions. Each area adds its controllers here.
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
    FilesController,
  ],
  providers: [CoursesService, LiveService, TeachingScopeService, QuizAttemptsService, FilesService, storageProvider],
  exports: [CoursesService],
})
export class ElearningModule {}
