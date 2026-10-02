import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from '../platform/subscription.service.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  providers: [AuditService, SubscriptionService],
  exports: [AuditService, SubscriptionService],
})
export class CommonModule {}
