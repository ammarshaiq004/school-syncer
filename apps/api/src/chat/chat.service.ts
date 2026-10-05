import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { campusScope, hasAnyRole, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { localToday, startOfLocalDay } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildContacts,
  canPost,
  canStartThreadAbout,
  preview,
  threadRole,
  type ThreadRole,
} from './chat-rules.js';

const name = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

export const threadSelect = {
  id: true,
  schoolId: true,
  studentId: true,
  guardianUserId: true,
  staffUserId: true,
  lastMessageAt: true,
  createdAt: true,
  student: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      campusId: true,
      photoUrl: true,
      enrollments: {
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          section: {
            select: { name: true, class: { select: { name: true } } },
          },
        },
      },
    },
  },
  guardianUser: { select: { id: true, name: true } },
  staffUser: { select: { id: true, name: true } },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { body: true, senderId: true, createdAt: true },
  },
} satisfies Prisma.ChatThreadSelect;

export type ThreadRow = Prisma.ChatThreadGetPayload<{
  select: typeof threadSelect;
}>;

/** Unread = not read yet and not sent by me (messages from removed accounts count too). */
export const unreadWhere = (userId: string): Prisma.ChatMessageWhereInput => ({
  readAt: null,
  OR: [{ senderId: null }, { senderId: { not: userId } }],
});

/** Threads this user takes part in: as a current guardian of the student, or as the staff member. */
export const memberThreadsWhere = (
  user: AuthUser,
): Prisma.ChatThreadWhereInput => ({
  schoolId: user.schoolId,
  OR: [
    {
      guardianUserId: user.sub,
      student: { guardians: { some: { guardian: { userId: user.sub } } } },
    },
    { staffUserId: user.sub },
  ],
});

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Safeguarding reads are audited: a setup role reading a conversation they
   * are not part of is recorded once per thread (or once for the all-threads
   * list, entityId null) per user per school day.
   */
  async recordObserve(user: AuthUser, threadId: string | null) {
    const action = 'chat.observe';
    const seen = await this.prisma.auditLog.findFirst({
      where: {
        schoolId: user.schoolId,
        userId: user.sub,
        action,
        entity: 'ChatThread',
        entityId: threadId,
        createdAt: { gte: startOfLocalDay(localToday()) },
      },
      select: { id: true },
    });
    if (!seen) await this.audit.record(user, action, 'ChatThread', threadId);
  }

  /** Is this staff member still the class teacher or a subject teacher of the student's current section? */
  async stillTeaches(staffUserId: string, studentId: string) {
    const n = await this.prisma.enrollment.count({
      where: {
        studentId,
        status: 'ACTIVE',
        section: {
          OR: [
            { classTeacherId: staffUserId },
            { subjects: { some: { teacherId: staffUserId } } },
          ],
        },
      },
    });
    return n > 0;
  }

  /** May this user observe threads about students at this campus (setup roles, safeguarding)? */
  canObserve(user: AuthUser, campusId: string): boolean {
    if (!hasAnyRole(user, SETUP_ROLES)) return false;
    const scope = campusScope(user);
    return !scope || scope.includes(campusId);
  }

  /** Loads a thread and this user's role in it; 404 for other schools and threads the user may not see. */
  async access(user: AuthUser, threadId: string) {
    const thread = await this.prisma.chatThread.findFirst({
      where: { id: threadId, schoolId: user.schoolId },
      select: threadSelect,
    });
    if (!thread) throw new NotFoundException('Conversation not found');
    const isGuardianOfStudent =
      thread.guardianUserId === user.sub &&
      (await this.prisma.studentGuardian.count({
        where: { studentId: thread.studentId, guardian: { userId: user.sub } },
      })) > 0;
    const role = threadRole(thread, user.sub, {
      isGuardianOfStudent,
      canObserve: this.canObserve(user, thread.student.campusId),
    });
    if (!role) throw new NotFoundException('Conversation not found');
    return { thread, role };
  }

  /** Like access() but only for the two participants, and only while both accounts exist. */
  async forPosting(user: AuthUser, threadId: string) {
    const { thread, role } = await this.access(user, threadId);
    if (role === 'OBSERVER')
      throw new ForbiddenException(
        'You can read this conversation but not post in it',
      );
    if (!canPost(thread, role))
      throw new ForbiddenException('This conversation is closed');
    // The staff side is a fixed user; once they no longer teach the student
    // the thread stays readable as history but they cannot post in it.
    if (
      role === 'STAFF' &&
      !(await this.stillTeaches(user.sub, thread.studentId))
    )
      throw new ForbiddenException(
        'You no longer teach this student, so this conversation is read-only',
      );
    return { thread, role };
  }

  async unreadByThread(
    user: AuthUser,
    threadIds?: string[],
  ): Promise<Map<string, number>> {
    const groups = await this.prisma.chatMessage.groupBy({
      by: ['threadId'],
      where: {
        ...unreadWhere(user.sub),
        thread: memberThreadsWhere(user),
        ...(threadIds ? { threadId: { in: threadIds } } : {}),
      },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.threadId, g._count._all]));
  }

  toDto(
    t: ThreadRow,
    user: AuthUser,
    role: ThreadRole,
    unread: number,
    postable = true,
  ) {
    const section = t.student.enrollments[0]?.section;
    const last = t.messages[0];
    return {
      id: t.id,
      student: {
        id: t.student.id,
        name: name(t.student),
        photoUrl: t.student.photoUrl,
        className: section ? `${section.class.name} ${section.name}` : null,
      },
      guardian: t.guardianUser,
      staff: t.staffUser,
      role,
      canPost: postable && canPost(t, role),
      lastMessageAt: t.lastMessageAt,
      lastMessage: last
        ? {
            preview: preview(last.body),
            senderId: last.senderId,
            mine: last.senderId === user.sub,
            createdAt: last.createdAt,
          }
        : null,
      unread: role === 'OBSERVER' ? 0 : unread,
      createdAt: t.createdAt,
    };
  }

  /** The student's current section (for the staff-side access rule), or null. */
  private async studentSection(user: AuthUser, studentId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId: user.schoolId },
      select: {
        campusId: true,
        enrollments: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            section: {
              select: {
                classTeacherId: true,
                subjects: { select: { teacherId: true } },
              },
            },
          },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    return { student, section: student.enrollments[0]?.section ?? null };
  }

  /**
   * Staff side of starting a conversation: the students this user may message
   * about, with the guardians who have a login and any thread already open.
   * Administrators get their campus scope, teachers the sections they
   * class-teach or teach a subject in.
   */
  async staffContacts(user: AuthUser) {
    const admin = hasAnyRole(user, SETUP_ROLES);
    const scope = campusScope(user);
    const students = await this.prisma.student.findMany({
      where: {
        schoolId: user.schoolId,
        ...(scope ? { campusId: { in: scope } } : {}),
        enrollments: {
          some: {
            status: 'ACTIVE',
            section: {
              academicYear: { isCurrent: true },
              ...(admin
                ? {}
                : {
                    OR: [
                      { classTeacherId: user.sub },
                      { subjects: { some: { teacherId: user.sub } } },
                    ],
                  }),
            },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 500,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        photoUrl: true,
        enrollments: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            section: {
              select: { name: true, class: { select: { name: true } } },
            },
          },
        },
        guardians: {
          orderBy: [{ isPrimary: 'desc' }, { relation: 'asc' }],
          select: {
            relation: true,
            isPrimary: true,
            guardian: {
              select: {
                name: true,
                user: { select: { id: true, isActive: true } },
              },
            },
          },
        },
        chatThreads: {
          where: { staffUserId: user.sub },
          select: { id: true, guardianUserId: true },
        },
      },
    });
    return students.map((student) => {
      const section = student.enrollments[0]?.section;
      const threadFor = new Map(
        student.chatThreads.map((t) => [t.guardianUserId, t.id]),
      );
      return {
        student: {
          id: student.id,
          name: name(student),
          admissionNo: student.admissionNo,
          photoUrl: student.photoUrl,
          className: section ? `${section.class.name} ${section.name}` : null,
        },
        // Only guardians with an active login can be messaged.
        guardians: student.guardians
          .filter((g) => g.guardian.user?.isActive)
          .map((g) => ({
            userId: g.guardian.user?.id as string,
            name: g.guardian.name,
            relation: g.relation,
            isPrimary: g.isPrimary,
            threadId: threadFor.get(g.guardian.user?.id as string) ?? null,
          })),
      };
    });
  }

  /** Checks that this staff member may start a conversation about the student with this guardian. */
  async assertCanStartThread(
    user: AuthUser,
    studentId: string,
    guardianUserId: string,
  ) {
    const { student, section } = await this.studentSection(user, studentId);
    const scope = campusScope(user);
    if (scope && !scope.includes(student.campusId))
      throw new NotFoundException('Student not found');
    const isAdmin = hasAnyRole(user, SETUP_ROLES);
    if (!canStartThreadAbout(section, user.sub, { isAdmin })) {
      throw new ForbiddenException(
        'You can only message the parents of students you teach',
      );
    }
    const guardian = await this.prisma.studentGuardian.findFirst({
      where: {
        studentId,
        guardian: { userId: guardianUserId, user: { isActive: true } },
      },
      select: { guardianId: true },
    });
    if (!guardian)
      throw new BadRequestException(
        'That guardian is not linked to this student',
      );
  }

  /** A parent's children (current guardian link) with their teachers as contacts. */
  async contacts(user: AuthUser) {
    const links = await this.prisma.studentGuardian.findMany({
      where: {
        guardian: { userId: user.sub, schoolId: user.schoolId },
        student: { schoolId: user.schoolId },
      },
      orderBy: { student: { firstName: 'asc' } },
      select: {
        relation: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            photoUrl: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                section: {
                  select: {
                    name: true,
                    class: { select: { name: true } },
                    classTeacher: {
                      select: { id: true, name: true, isActive: true },
                    },
                    subjects: {
                      select: {
                        subject: { select: { name: true } },
                        teacher: {
                          select: { id: true, name: true, isActive: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            chatThreads: {
              where: { guardianUserId: user.sub },
              select: { id: true, staffUserId: true },
            },
          },
        },
      },
    });
    const active = <T extends { isActive: boolean }>(u: T | null) =>
      u && u.isActive ? u : null;
    return links.map(({ student, relation }) => {
      const section = student.enrollments[0]?.section;
      const threadFor = new Map(
        student.chatThreads.map((t) => [t.staffUserId, t.id]),
      );
      const contacts = section
        ? buildContacts({
            classTeacher: active(section.classTeacher),
            subjects: section.subjects.map((s) => ({
              subject: s.subject.name,
              teacher: active(s.teacher),
            })),
          })
        : [];
      return {
        student: {
          id: student.id,
          name: name(student),
          photoUrl: student.photoUrl,
          relation,
          className: section ? `${section.class.name} ${section.name}` : null,
        },
        contacts: contacts.map((c) => ({
          ...c,
          threadId: threadFor.get(c.userId) ?? null,
        })),
      };
    });
  }
}
