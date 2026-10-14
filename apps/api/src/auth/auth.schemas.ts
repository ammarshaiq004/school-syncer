import { SchoolMode } from '@prisma/client';
import { z } from 'zod';

export const registerSchoolSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  city: z.string().trim().max(80).optional(),
  ownerName: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(8).max(128),
  /** Physical campus, online school or both; drives which modules the app shows. */
  mode: z.enum(SchoolMode).default(SchoolMode.PHYSICAL),
});
export type RegisterSchoolInput = z.infer<typeof registerSchoolSchema>;

export const loginSchema = z.object({
  schoolSlug: z.string().trim().min(1),
  /** Email address, phone number or username (students sign in with their admission number). */
  login: z.string().trim().min(1).max(120),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * A password the user picks themselves: at least 8 characters with a letter
 * and a digit. Temporary passwords (temporaryPassword()) always pass it.
 */
export const newPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Use at least one letter')
  .regex(/\d/, 'Use at least one number');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: newPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const resetPhone = z
  .string()
  .trim()
  .min(1, 'Enter your mobile number')
  .max(20)
  .refine((v) => v.replace(/\D/g, '').length >= 10, 'Enter the mobile number on your account, e.g. 03001234567');

/** Step 1 of "forgot password": where to send the code. */
export const forgotPasswordSchema = z.object({
  schoolSlug: z.string().trim().min(1).max(80),
  phone: resetPhone,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Step 2: the code from the message and the new password. */
export const resetPasswordSchema = z.object({
  schoolSlug: z.string().trim().min(1).max(80),
  phone: resetPhone,
  code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 digits'),
  newPassword: newPasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
