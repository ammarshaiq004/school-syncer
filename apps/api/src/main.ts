import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { errorReporter } from './observability/error-reporter.js';
import { JsonLogger, jsonLogsEnabled } from './observability/json-logger.js';

/**
 * TRUST_PROXY as Express understands it: a hop count ("1"), "true", or a
 * comma-separated list of proxy addresses/subnets. Set it when the API runs
 * behind a reverse proxy, so the sign-in rate limit sees the client's IP
 * rather than the proxy's (otherwise anyone could lock a login out).
 */
function trustProxy(value: string | undefined): boolean | number | string | undefined {
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/**
 * Crashes outside a request (a timer, a stray promise) reach the error
 * tracker too. A rejection is reported and logged; an uncaught exception is
 * reported, then the process exits as Node would, for the supervisor to
 * restart it.
 */
function reportProcessErrors() {
  const logger = new Logger('Process');
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${(reason as Error)?.message ?? String(reason)}`, (reason as Error)?.stack);
    void errorReporter().captureException(reason, { tags: { kind: 'unhandledRejection' } });
  });
  process.on('uncaughtException', (error) => {
    logger.fatal(`Uncaught exception: ${error.message}`, error.stack);
    void errorReporter()
      .captureException(error, { level: 'fatal', tags: { kind: 'uncaughtException' } })
      .finally(() => process.exit(1));
  });
}

async function bootstrap() {
  reportProcessErrors();
  // rawBody lets payment webhooks verify signatures over the exact bytes sent.
  // Production logs are JSON lines with the request id (LOG_FORMAT overrides).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    ...(jsonLogsEnabled() && { logger: new JsonLogger() }),
  });
  const proxy = trustProxy(process.env.TRUST_PROXY);
  if (proxy !== undefined) app.set('trust proxy', proxy);
  // Security headers (HSTS, nosniff, no framing, no referrer). The API serves
  // JSON and files, so its pages may load, run and frame nothing; the file
  // route sets its own policy for what it serves.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
    }),
  );
  // Gateway statements arrive as JSON grids, larger than Express's 100kb default.
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  // Comma-separated, e.g. the web portal and the app's web preview.
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  // The portal reads X-Request-Id to show a reference with server errors.
  app.enableCors({ origin: origins, exposedHeaders: ['X-Request-Id'] });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
  if (errorReporter().enabled) new Logger('ErrorReporter').log('Errors are reported to the tracker at SENTRY_DSN.');
}
await bootstrap();
