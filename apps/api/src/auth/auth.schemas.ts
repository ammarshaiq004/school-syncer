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
