import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service.js';
import { SystemHealthController } from './system-health.controller.js';
import { SystemHealthService } from './system-health.service.js';

/** Readiness, the console's System health page and the recurring alert check. */
@Module({
  controllers: [SystemHealthController],
  providers: [SystemHealthService, AlertsService],
  exports: [SystemHealthService, AlertsService],
})
export class MonitoringModule {}
