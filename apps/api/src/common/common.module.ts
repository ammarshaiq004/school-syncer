import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from '../platform/subscription.service.js';
import { ActivityService } from './activity.service.js';
import { AuditService } from './audit.service.js';
import { PermissionService } from './permission.service.js';
import { UserStatusService } from './user-status.service.js';

@Global()
@Module({
  providers: [AuditService, SubscriptionService, PermissionService, UserStatusService, ActivityService],
  exports: [ActivityService, AuditService, SubscriptionService, PermissionService, UserStatusService],
})
export class CommonModule {}
