import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformReportsController } from './platform-reports.controller.js';
import { PlatformSchoolsController } from './platform-schools.controller.js';
import { PlatformStaffController } from './platform-staff.controller.js';

/**
 * Console features added with platform roles. The original console
 * controllers are still registered in AppModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    PlatformStaffController,
    PlatformSchoolsController,
    PlatformReportsController,
  ],
})
export class PlatformModule {}
