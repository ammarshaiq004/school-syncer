import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { tooManyRequests } from '../common/rate-limit.guard.js';
import { previousSecrets } from '../common/signing-secrets.js';
import { UserStatusService } from '../common/user-status.service.js';
import { COUNTER_STORE, type CounterStore } from '../jobs/counter-store.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toInternational } from '../notifications/phone.js';
import { MessagingSenders } from '../notifications/senders.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ForgotPasswordInput, ResetPasswordInput } from './auth.schemas.js';
import { BCRYPT_ROUNDS } from './school-setup.service.js';

export const RESET_CODE_MINUTES = 10;
export const RESET_MAX_ATTEMPTS = 5;
/** Code requests per phone number per hour, and per address per hour. */
export const RESET_PER_PHONE = 3;
export const RESET_PER_IP = 10;
const HOUR_MS = 60 * 60_000;

const WRONG_CODE = 'That code is wrong or has expired. Check the latest message or request a new code.';
const TOO_MANY = 'Too many wrong codes. Request a new code.';

/** What the request step answers. "sent" never says whether an account exists. */
export type ForgotPasswordResult = { status: 'sent' | 'unavailable' };

/**
 * "Forgot password" for school users with a phone number on their account:
 * a 6-digit code sent through the school's messaging (WhatsApp or SMS),
 * stored only as a hash, valid for 10 minutes and 5 tries. Requests are
 * limited per phone and per address in the shared counter store, and the
 * answers are the same whether or not the number has an account. A school
 * that cannot deliver messages gets "unavailable": the user asks the office
 * for an admin reset. Email is not offered (there is no email provider yet).
 */
@Injectable()
export class PasswordResetService {
  /** Replaceable in tests. */
  now: () => number = Date.now;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly senders: MessagingSenders,
    private readonly userStatus: UserStatusService,
    @Inject(COUNTER_STORE) private readonly counters: CounterStore,
  ) {}

  async request(input: ForgotPasswordInput): Promise<ForgotPasswordResult> {
    const phone = toInternational(input.phone);
    const slug = input.schoolSlug.toLowerCase();
    // Counted before any lookup, so the limit says nothing about accounts.
    // The per-address limit is the route's @RateLimit.
    await this.limit(`reset-phone|${slug}|${phone}`, RESET_PER_PHONE);

    const school = await this.prisma.school.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (!school) return { status: 'sent' };
    const sender = await this.senders.forSchool(school.id);
    if (sender.source === 'log') return { status: 'unavailable' };
    const users = await this.accounts(school.id, phone);
    if (!users.length) return { status: 'sent' };

    const now = new Date(this.now());
    // Only the newest code works.
    await this.prisma.passwordResetCode.updateMany({
      where: { schoolId: school.id, phone, usedAt: null },
      data: { usedAt: now },
    });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.passwordResetCode.create({
      data: {
        schoolId: school.id,
        phone,
        codeHash: this.hash(school.id, phone, code),
        expiresAt: new Date(now.getTime() + RESET_CODE_MINUTES * 60_000),
      },
    });
    await this.notifications.send(
      school.id,
      [{ to: phone, template: 'password.reset', params: { code, schoolName: school.name } }],
      { urgent: true },
    );
    return { status: 'sent' };
  }

  /** Checks the code and sets the new password on every account with this phone number. */
  async reset(input: ResetPasswordInput) {
    const phone = toInternational(input.phone);
    const school = await this.prisma.school.findUnique({ where: { slug: input.schoolSlug.toLowerCase() }, select: { id: true } });
    if (!school) throw new BadRequestException(WRONG_CODE);
    const now = new Date(this.now());
    const row = await this.prisma.passwordResetCode.findFirst({
      where: { schoolId: school.id, phone, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new BadRequestException(WRONG_CODE);
    // Counted before checking, atomically, so parallel guesses cannot exceed the limit.
    const counted = await this.prisma.passwordResetCode.updateMany({
      where: { id: row.id, usedAt: null, attempts: { lt: RESET_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (!counted.count) throw new BadRequestException(TOO_MANY);
    if (!this.hashes(school.id, phone, input.code).some((h) => this.matches(row.codeHash, h))) {
      throw new BadRequestException(row.attempts + 1 >= RESET_MAX_ATTEMPTS ? TOO_MANY : WRONG_CODE);
    }
    const claimed = await this.prisma.passwordResetCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (!claimed.count) throw new BadRequestException(WRONG_CODE);
    const users = await this.accounts(school.id, phone);
    if (!users.length) throw new BadRequestException(WRONG_CODE);

    const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: { in: users.map((u) => u.id) } },
        // The user chose this password, and every older session ends.
        data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
      }),
      this.prisma.auditLog.createMany({
        data: users.map((u) => ({
          schoolId: school.id,
          userId: u.id,
          action: 'user.reset_password',
          entity: 'User',
          entityId: u.id,
          after: { via: 'phone code' },
        })),
      }),
    ]);
    users.forEach((u) => this.userStatus.forget(u.id));
    return { ok: true };
  }

  /** Active accounts in the school whose phone number is this one, however it was typed. */
  private async accounts(schoolId: string, phone: string): Promise<{ id: string }[]> {
    const tail = phone.slice(-10);
    if (tail.length < 7) return [];
    const rows = await this.prisma.$queryRaw<{ id: string; phone: string }[]>`
      SELECT "id", "phone" FROM "User"
      WHERE "schoolId" = ${schoolId} AND "isActive" = true AND "phone" IS NOT NULL
        AND regexp_replace("phone", '\\D', '', 'g') LIKE ${`%${tail}`}`;
    return rows.filter((u) => toInternational(u.phone) === phone).map(({ id }) => ({ id }));
  }

  private async limit(key: string, max: number) {
    const now = this.now();
    const counter = await this.counters.increment(key, HOUR_MS, now);
    if (counter.count > max) throw tooManyRequests(counter.resetAt - now);
  }

  private hash(schoolId: string, phone: string, code: string, secret = this.config.getOrThrow<string>('JWT_SECRET')) {
    return createHmac('sha256', secret).update(`${schoolId}|${phone}|${code}`).digest('hex');
  }

  /** The code's hash under JWT_SECRET and, during a rotation, each JWT_SECRET_PREVIOUS. */
  private hashes(schoolId: string, phone: string, code: string) {
    const previous = previousSecrets(this.config.get<string>('JWT_SECRET_PREVIOUS'));
    return [this.hash(schoolId, phone, code), ...previous.map((secret) => this.hash(schoolId, phone, code, secret))];
  }

  private matches(stored: string, given: string) {
    const a = Buffer.from(stored, 'hex');
    const b = Buffer.from(given, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
