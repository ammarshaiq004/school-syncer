import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { AllowAnyAppVersion, Public } from '../common/decorators.js';
import { SystemHealthService } from '../monitoring/system-health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: SystemHealthService) {}

  /**
   * Liveness, for load balancers and uptime checks: 200 when the database
   * answers, 503 when it does not.
   */
  @Public()
  @AllowAnyAppVersion()
  @Get()
  async check() {
    if (!(await this.health.database()).ok) {
      throw new HttpException({ status: 'error', database: 'down' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok' };
  }

  /**
   * Readiness, for deploy gates and monitors: the database, the job queue
   * (backlog and how long the oldest due job has waited) and the age of the
   * last successful nightly reconciliation. 503 with the failing check when
   * any is wrong. Load balancers should keep using /health, so a stale
   * reconciliation does not take the API out of rotation.
   */
  @Public()
  @AllowAnyAppVersion()
  @Get('ready')
  async ready() {
    const readiness = await this.health.readiness();
    if (readiness.status !== 'ok') throw new HttpException(readiness, HttpStatus.SERVICE_UNAVAILABLE);
    return readiness;
  }
}
