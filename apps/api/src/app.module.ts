import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdmissionsController } from './admissions/admissions.controller.js';
import { AnnouncementsController } from './announcements/announcements.controller.js';
import { AttendanceController } from './attendance/attendance.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { ExamsController } from './exams/exams.controller.js';
import { HomeworkController } from './homework/homework.controller.js';
import { TimetableController } from './timetable/timetable.controller.js';
import { TransportController } from './transport/transport.controller.js';
import { LibraryController } from './library/library.controller.js';
import {
  CertificatesController,
  VerifyController,
} from './certificates/certificates.controller.js';
import { PromotionsController } from './promotions/promotions.controller.js';
import { HrController } from './hr/hr.controller.js';
import { PayrollController } from './hr/payroll.controller.js';
import { AccountsController } from './accounts/accounts.controller.js';
import { ReportsController } from './reports/reports.controller.js';
import { FeesController } from './fees/fees.controller.js';
import { PaymentWebhookController } from './fees/payment-webhook.controller.js';
import { PaymentsService } from './fees/payments.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ElearningModule } from './elearning/elearning.module.js';
import { GradebookModule } from './gradebook/gradebook.module.js';
import { LessonPlansModule } from './lesson-plans/lesson-plans.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AssistantModule } from './assistant/assistant.module.js';
import { ParentController } from './parent/parent.controller.js';
import { ParentRecordsController } from './parent/parent-records.controller.js';
import { StudentsController } from './students/students.controller.js';
import { StudentController } from './student/student.controller.js';
import { AcademicYearsController } from './academic-years/academic-years.controller.js';
import { AuditController } from './audit/audit.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { CampusesController } from './campuses/campuses.controller.js';
import { ClassesController } from './classes/classes.controller.js';
import { CommonModule } from './common/common.module.js';
import { JwtAuthGuard } from './common/jwt-auth.guard.js';
import { PermissionGuard } from './common/permission.guard.js';
import { RolesGuard } from './common/roles.guard.js';
import { RolesController } from './roles/roles.controller.js';
import { SubscriptionGuard } from './common/subscription.guard.js';
import { PlatformController } from './platform/platform.controller.js';
import { PlatformAuthController } from './platform/platform-auth.controller.js';
import { PlatformModule } from './platform/platform.module.js';
import { SubscriptionController } from './platform/subscription.controller.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SchoolController } from './school/school.controller.js';
import { SubjectsController } from './subjects/subjects.controller.js';
import { UsersController } from './users/users.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '12h') },
      }),
    }),
    PrismaModule,
    CommonModule,
    AuthModule,
    PlatformModule,
    NotificationsModule,
    ElearningModule,
    GradebookModule,
    LessonPlansModule,
    ChatModule,
    AssistantModule,
  ],
  controllers: [
    HealthController,
    SchoolController,
    CampusesController,
    AcademicYearsController,
    ClassesController,
    SubjectsController,
    UsersController,
    RolesController,
    AuditController,
    StudentsController,
    AdmissionsController,
    AttendanceController,
    FeesController,
    ExamsController,
    TimetableController,
    TransportController,
    LibraryController,
    CertificatesController,
    VerifyController,
    PromotionsController,
    HomeworkController,
    HrController,
    PayrollController,
    AccountsController,
    ReportsController,
    PaymentWebhookController,
    AnnouncementsController,
    DashboardController,
    ParentController,
    ParentRecordsController,
    StudentController,
    SubscriptionController,
    PlatformAuthController,
    PlatformController,
  ],
  providers: [
    PaymentsService,
    // Order matters: authenticate first, then check roles, then the school's plan.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    // Last: the school's role matrix (@Permission) narrows what @Roles allowed.
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
