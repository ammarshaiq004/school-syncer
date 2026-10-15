import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_ANY_APP_VERSION } from '../common/decorators.js';
import { platformFromHeader } from './app-release.js';
import { AppVersionService } from './app-version.service.js';
import { updateStatus } from './version.js';

/** 426 Upgrade Required; not in Nest's HttpStatus enum. */
export const UPGRADE_REQUIRED = 426;
export const APP_UPDATE_REQUIRED = 'APP_UPDATE_REQUIRED';

/**
 * Refuses requests from mobile app builds below the minimum version with
 * 426 and code APP_UPDATE_REQUIRED, which the app turns into its "Update
 * required" screen. Only requests that say they come from the iOS or Android
 * app (X-App-Platform) with a readable X-App-Version are checked: the web
 * portal, the app's web preview, payment gateways and builds that predate the
 * headers pass untouched. If the policy cannot be read it fails open.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  private readonly logger = new Logger(AppVersionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly versions: AppVersionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const platform = platformFromHeader(req.headers['x-app-platform']);
    const version = req.headers['x-app-version'];
    if (!platform || typeof version !== 'string') return true;
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_ANY_APP_VERSION, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    let release;
    try {
      release = await this.versions.release(platform);
    } catch (e) {
      this.logger.warn(`App version policy unavailable, letting the request through: ${(e as Error).message}`);
      return true;
    }
    if (updateStatus(version, release) !== 'required') return true;
    throw new HttpException(
      {
        statusCode: UPGRADE_REQUIRED,
        code: APP_UPDATE_REQUIRED,
        message:
          release.message ||
          'This version of SchoolSyncer is no longer supported. Update the app to carry on.',
        minVersion: release.minVersion,
        storeUrl: release.storeUrl,
      },
      UPGRADE_REQUIRED,
    );
  }
}
