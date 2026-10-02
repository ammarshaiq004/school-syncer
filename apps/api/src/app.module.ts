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
import { HrController } from './hr/hr.controller.js';
import { PayrollController } from './hr/payroll.controller.js';
import { AccountsController } from './accounts/accounts.controller.js';
import { ReportsController } from './reports/reports.controller.js';
import { FeesController } from './fees/fees.controller.js';
import { PaymentWebhookController } from './fees/payment-webhook.controller.js';
import { PaymentsService } from './fees/payments.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ParentController } from './parent/parent.controller.js';
import { StudentsController } from './students/students.controller.js';
import { AcademicYearsController } from './academic-years/academic-years.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { CampusesController } from './campuses/campuses.controller.js';
import { ClassesController } from './classes/classes.controller.js';
import { CommonModule } from './common/common.module.js';
import { JwtAuthGuard } from './common/jwt-auth.guard.js';
import { RolesGuard } from './common/roles.guard.js';
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
    NotificationsModule,
  ],
  controllers: [
    HealthController,
    SchoolController,
    CampusesController,
    AcademicYearsController,
    ClassesController,
    SubjectsController,
    UsersController,
    StudentsController,
    AdmissionsController,
    AttendanceController,
    FeesController,
    ExamsController,
    TimetableController,
    HomeworkController,
    HrController,
    PayrollController,
    AccountsController,
    ReportsController,
    PaymentWebhookController,
    AnnouncementsController,
    DashboardController,
    ParentController,
  ],
  providers: [
    PaymentsService,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
