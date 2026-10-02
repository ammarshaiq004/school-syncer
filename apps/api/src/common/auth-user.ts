import { Role } from '@prisma/client';

export interface RoleGrant {
  role: Role;
  campusId: string | null;
}

/** The signed-in user, as carried in the JWT and attached to each request. */
export interface AuthUser {
  sub: string;
  schoolId: string;
  name: string;
  roles: RoleGrant[];
}
