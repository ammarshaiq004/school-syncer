import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
import { FeeCorrectionsController } from './fees/fee-corrections.controller.js';
import { FeeCorrectionsService } from './fees/fee-corrections.service.js';
import { FeeHeadsController } from './fees/fee-heads.controller.js';
import { FeesController } from './fees/fees.controller.js';
import { VoucherRunsService } from './fees/voucher-runs.service.js';
import { PaymentAccountsController } from './fees/payment-accounts.controller.js';
import { PaymentWebhookController } from './fees/payment-webhook.controller.js';
import { PaymentsService } from './fees/payments.service.js';
import {
  OnlinePaymentsAdminController,
  ParentPaymentsController,
  PaymentGatewayController,
} from './fees/online-payments.controller.js';
import { OnlinePaymentsService } from './fees/online-payments.service.js';
import { GatewayChecksService } from './fees/gateway-checks.service.js';
import { GatewayTestsService } from './fees/gateway-tests.service.js';
import { ReconciliationController } from './fees/reconciliation/reconciliation.controller.js';
import { ReconciliationScheduler } from './fees/reconciliation/reconciliation.scheduler.js';
import { ReconciliationService } from './fees/reconciliation/reconciliation.service.js';
import { JobsModule } from './jobs/jobs.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ElearningModule } from './elearning/elearning.module.js';
import { GradebookModule } from './gradebook/gradebook.module.js';
import { LessonPlansModule } from './lesson-plans/lesson-plans.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AssistantModule } from './assistant/assistant.module.js';
import { ParentController } from './parent/parent.controller.js';
import { ParentRecordsController } from './parent/parent-records.controller.js';
import { StudentChangesController } from './students/student-changes.controller.js';
import {
  StudentPhotoContentController,
  StudentPhotoController,
  StudentPhotoLinks,
} from './students/student-photo.controller.js';
import { StudentsController } from './students/students.controller.js';
import { StudentController } from './student/student.controller.js';
import { AcademicYearsController } from './academic-years/academic-years.controller.js';
import { AuditController } from './audit/audit.controller.js';
import { AppVersionGuard } from './app-version/app-version.guard.js';
import { AppVersionModule } from './app-version/app-version.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CampusesController } from './campuses/campuses.controller.js';
import { ClassesController } from './classes/classes.controller.js';
import { CommonModule } from './common/common.module.js';
import { validateEnv } from './common/env.validation.js';
import { JwtAuthGuard } from './common/jwt-auth.guard.js';
import { PermissionGuard } from './common/permission.guard.js';
import { AppExceptionFilter } from './common/app-exception.filter.js';
import { RateLimitGuard } from './common/rate-limit.guard.js';
import { RolesGuard } from './common/roles.guard.js';
import { RolesController } from './roles/roles.controller.js';
import { SubscriptionGuard } from './common/subscription.guard.js';
import { BillingScheduler } from './platform/billing/billing.scheduler.js';
import { BillingService } from './platform/billing/billing.service.js';
import { PaymentClaimsController, PlatformPaymentClaimsController } from './platform/billing/payment-claims.controller.js';
import { PlatformController } from './platform/platform.controller.js';
import { PlatformAuthController } from './platform/platform-auth.controller.js';
import { PlatformGatewaysController } from './platform/platform-gateways.controller.js';
import { PlatformModule } from './platform/platform.module.js';
import { SubscriptionController } from './platform/subscription.controller.js';
import { HealthController } from './health/health.controller.js';
import { MonitoringModule } from './monitoring/monitoring.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { PlatformPilotController } from './pilot/platform-pilot.controller.js';
import { PlatformProblemReportsController } from './pilot/platform-problem-reports.controller.js';
import { ProblemReportsController } from './pilot/problem-reports.controller.js';
import { SetupChecklistController } from './pilot/setup-checklist.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SchoolController } from './school/school.controller.js';
import { SiteController } from './site/site.controller.js';
import { SubjectsController } from './subjects/subjects.controller.js';
import { UsersController } from './users/users.controller.js';

@Module({
  imports: [
    // Refuses to start on unsafe production settings (see validateEnv).
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '12h') },
      }),
    }),
    PrismaModule,
    ObservabilityModule,
    JobsModule,
    CommonModule,
    AuthModule,
    PlatformModule,
    AppVersionModule,
    NotificationsModule,
    ElearningModule,
    GradebookModule,
    LessonPlansModule,
    ChatModule,
    AssistantModule,
    MonitoringModule,
  ],
  controllers: [
    HealthController,
    SchoolController,
    SiteController,
    CampusesController,
    AcademicYearsController,
    ClassesController,
    SubjectsController,
    UsersController,
    RolesController,
    AuditController,
    StudentsController,
    StudentChangesController,
    StudentPhotoController,
    StudentPhotoContentController,
    AdmissionsController,
    AttendanceController,
    FeesController,
    FeeHeadsController,
    FeeCorrectionsController,
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
    PaymentGatewayController,
    OnlinePaymentsAdminController,
    ParentPaymentsController,
    ReconciliationController,
    PaymentAccountsController,
    AnnouncementsController,
    DashboardController,
    // Pilot kit (SCHOOL-150): setup checklist, problem reports, pilot health.
    SetupChecklistController,
    ProblemReportsController,
    PlatformProblemReportsController,
    PlatformPilotController,
    ParentController,
    ParentRecordsController,
    StudentController,
    SubscriptionController,
    PaymentClaimsController,
    PlatformPaymentClaimsController,
    PlatformAuthController,
    PlatformController,
    PlatformGatewaysController,
  ],
  providers: [
    StudentPhotoLinks,
    PaymentsService,
    FeeCorrectionsService,
    VoucherRunsService,
    OnlinePaymentsService,
    GatewayChecksService,
    GatewayTestsService,
    ReconciliationService,
    ReconciliationScheduler,
    BillingService,
    BillingScheduler,
    // First, so floods of public requests stop before any database work.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Then outdated mobile builds (426), before they can sign in or load anything.
    { provide: APP_GUARD, useClass: AppVersionGuard },
    // Order matters: authenticate first, then check roles, then the school's plan.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
    // Last: the school's role matrix (@Permission) narrows what @Roles allowed.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // Every error answer: database errors mapped, request id added, crashes reported.
    { provide: APP_FILTER, useFactory: () => new AppExceptionFilter() },
  ],
})
export class AppModule {}
