import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimiter } from './login-rate-limit.js';
import { SchoolSetupService } from './school-setup.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SchoolSetupService, LoginRateLimiter],
  exports: [AuthService, SchoolSetupService, LoginRateLimiter],
})
export class AuthModule {}
