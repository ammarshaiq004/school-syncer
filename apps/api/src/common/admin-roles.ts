import { Role } from '@prisma/client';

/** Roles allowed to change school setup (campuses, classes, users). */
export const SETUP_ROLES: Role[] = [Role.OWNER, Role.PRINCIPAL, Role.ADMIN];
