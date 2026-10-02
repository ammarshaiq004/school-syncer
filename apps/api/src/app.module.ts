import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
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
  ],
  controllers: [
    HealthController,
    SchoolController,
    CampusesController,
    AcademicYearsController,
    ClassesController,
    SubjectsController,
    UsersController,
  ],
  providers: [
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
