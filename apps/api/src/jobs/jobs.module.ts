import { Global, Module } from '@nestjs/common';
import { COUNTER_STORE, PgCounterStore } from './counter-store.js';
import { JobWorker } from './job-worker.js';
import { JobsService } from './jobs.service.js';

/** Background jobs and the shared rate-limit counters, both in Postgres. */
@Global()
@Module({
  providers: [JobsService, JobWorker, { provide: COUNTER_STORE, useClass: PgCounterStore }],
  exports: [JobsService, COUNTER_STORE],
})
export class JobsModule {}
