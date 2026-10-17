import { Module } from '@nestjs/common';
import {
  AppVersionController,
  PlatformAppVersionsController,
} from './app-version.controller.js';
import { AppVersionService } from './app-version.service.js';

/** Mobile app version gate: the public check, the console settings and the policy the guard reads. */
@Module({
  controllers: [AppVersionController, PlatformAppVersionsController],
  providers: [AppVersionService],
  exports: [AppVersionService],
})
export class AppVersionModule {}
