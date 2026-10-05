import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

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

async function bootstrap() {
  // rawBody lets payment webhooks verify signatures over the exact bytes sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const proxy = trustProxy(process.env.TRUST_PROXY);
  if (proxy !== undefined) app.set('trust proxy', proxy);
  app.setGlobalPrefix('api');
  // Comma-separated, e.g. the web portal and the app's web preview.
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
