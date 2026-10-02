import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Public } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  loginSchema,
  registerSchoolSchema,
  type LoginInput,
  type RegisterSchoolInput,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register-school')
  registerSchool(
    @Body(new ZodValidationPipe(registerSchoolSchema)) body: RegisterSchoolInput,
  ) {
    return this.auth.registerSchool(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
