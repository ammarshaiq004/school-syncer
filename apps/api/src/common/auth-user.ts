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
   * The user's token version when this token was issued. A password change or
   * reset bumps the stored version, which ends every older session. Missing
   * on tokens issued before versions existed; treated as 0.
   */
  tv?: number;
  /**
   * Not signed into tokens: JwtAuthGuard sets it from the database when the
   * user still has to replace a password someone else issued.
   */
  mustChangePassword?: boolean;
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
  /** The admin's token version at sign-in; see AuthUser.tv. */
  tv?: number;
}
