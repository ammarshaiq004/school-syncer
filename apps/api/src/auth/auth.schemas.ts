import { z } from 'zod';

export const registerSchoolSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  city: z.string().trim().max(80).optional(),
  ownerName: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(8).max(128),
});
export type RegisterSchoolInput = z.infer<typeof registerSchoolSchema>;

export const loginSchema = z.object({
  schoolSlug: z.string().trim().min(1),
  /** Email address or phone number. */
  login: z.string().trim().min(3),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;
