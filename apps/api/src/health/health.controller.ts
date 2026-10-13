import { Controller, Get, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Public } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** How long the database may take to answer before the API counts as down. */
const DB_TIMEOUT_MS = 3000;

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /** For load balancers and uptime checks: 200 when the database answers, 503 when it does not. */
  @Public()
  @Get()
  async check() {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer in ${DB_TIMEOUT_MS} ms`)), DB_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.logger.error(`Database check failed: ${(error as Error).message}`);
      throw new HttpException({ status: 'error', database: 'down' }, HttpStatus.SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timer);
    }
    return { status: 'ok' };
  }
}
