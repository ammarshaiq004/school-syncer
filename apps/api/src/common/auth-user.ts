import { PlatformRole, Role } from '@prisma/client';

export interface RoleGrant {
  role: Role;
  campusId: string | null;
  /** Set when the grant is a school-defined custom role; `role` is then its base role. */
  customRoleId?: string | null;
}

/** The signed-in user, as carried in the JWT and attached to each request. */
export interface AuthUser {
  sub: string;
  schoolId: string;
  name: string;
  roles: RoleGrant[];
  /**
   * Present only on a support session: a SchoolSyncer staff member signed in
   * as this user from the platform console.
   */
  support?: { adminId: string; adminName: string };
}

/** A SchoolSyncer staff member signed in to the platform console. */
export interface PlatformUser {
  sub: string;
  name: string;
  platform: true;
  /** Missing on tokens issued before platform roles existed; treat as SUPPORT. */
  role?: PlatformRole;
}
