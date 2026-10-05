import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import {
  ATTENDANCE_ROLES,
  campusScope,
  hasAnyRole,
  SETUP_ROLES,
} from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createThreadSchema,
  messagesQuerySchema,
  sendMessageSchema,
  threadsQuerySchema,
  type CreateThread,
  type MessagesQuery,
  type SendMessage,
  type ThreadsQuery,
} from './chat-rules.js';
import {
  ChatService,
  memberThreadsWhere,
  threadSelect,
  unreadWhere,
} from './chat.service.js';

const CHAT_ROLES: Role[] = [...ATTENDANCE_ROLES, Role.PARENT];

const messageSelect = {
  id: true,
  body: true,
  senderId: true,
  createdAt: true,
  readAt: true,
  sender: { select: { name: true } },
} satisfies Prisma.ChatMessageSelect;

/** Parent side: who a parent can message about each child. */
@Controller('parent/chat')
@Permission('chat', 'view')
@Roles(Role.PARENT)
export class ParentChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('contacts')
  contacts(@CurrentUser() user: AuthUser) {
    return this.chat.contacts(user);
  }
}

/**
 * Parent-teacher chat (SCHOOL-25). Membership is strict: a parent sees only
 * threads about a student they are currently a guardian of, staff only threads
 * where they are the staff member. Setup roles can read any thread about a
 * student in their campus scope (scope=all), read-only. Threads the user may
 * not see answer 404, never 403, so ids cannot be probed.
 */
@Controller('chat')
@Permission('chat', 'view')
@Roles(...CHAT_ROLES)
export class ChatController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly audit: AuditService,
  ) {}

  @Get('threads')
  async threads(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(threadsQuerySchema)) q: ThreadsQuery,
  ) {
    let where: Prisma.ChatThreadWhereInput;
    if (q.scope === 'all') {
      if (!hasAnyRole(user, SETUP_ROLES))
        throw new ForbiddenException(
          'Only school administrators can view all conversations',
        );
      const scope = campusScope(user);
      where = {
        schoolId: user.schoolId,
        ...(scope ? { student: { campusId: { in: scope } } } : {}),
      };
      await this.chat.recordObserve(user, null);
    } else {
      where = memberThreadsWhere(user);
    }
    if (q.studentId) where = { AND: [where, { studentId: q.studentId }] };
    const rows = await this.prisma.chatThread.findMany({
      where,
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: 200,
      select: threadSelect,
    });
    const unread = await this.chat.unreadByThread(
      user,
      rows.map((r) => r.id),
    );
    return rows.map((t) => {
      const role =
        t.staffUserId === user.sub
          ? 'STAFF'
          : t.guardianUserId === user.sub && q.scope === 'mine'
            ? 'PARENT'
            : 'OBSERVER';
      return this.chat.toDto(t, user, role, unread.get(t.id) ?? 0);
    });
  }

  /** Parents start (or reopen) a conversation with one of their child's teachers. */
  @Post('threads')
  @Permission('chat')
  @Roles(Role.PARENT)
  async createThread(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createThreadSchema)) body: CreateThread,
  ) {
    const link = await this.prisma.studentGuardian.findFirst({
      where: {
        studentId: body.studentId,
        guardian: { userId: user.sub },
        student: { schoolId: user.schoolId },
      },
      select: { studentId: true },
    });
    if (!link) throw new NotFoundException('Student not found');
    const children = await this.chat.contacts(user);
    const child = children.find((c) => c.student.id === body.studentId);
    if (!child?.contacts.some((c) => c.userId === body.staffUserId)) {
      throw new BadRequestException(
        "You can only message your child's class teacher or subject teachers",
      );
    }
    const key = {
      studentId: body.studentId,
      guardianUserId: user.sub,
      staffUserId: body.staffUserId,
    };
    const where = { studentId_guardianUserId_staffUserId: key };
    let thread = await this.prisma.chatThread.findUnique({
      where,
      select: threadSelect,
    });
    if (!thread) {
      try {
        thread = await this.prisma.chatThread.create({
          data: { schoolId: user.schoolId, ...key },
          select: threadSelect,
        });
        await this.audit.record(
          user,
          'chat.thread_create',
          'ChatThread',
          thread.id,
          { after: key },
        );
      } catch (e) {
        // A concurrent request from the same parent created it first.
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          e.code !== 'P2002'
        )
          throw e;
        thread = await this.prisma.chatThread.findUniqueOrThrow({
          where,
          select: threadSelect,
        });
      }
    }
    const unread = await this.chat.unreadByThread(user, [thread.id]);
    return this.chat.toDto(thread, user, 'PARENT', unread.get(thread.id) ?? 0);
  }

  /** Unread message counts across the user's own threads. */
  @Get('unread')
  async unread(@CurrentUser() user: AuthUser) {
    const byThread = await this.chat.unreadByThread(user);
    let total = 0;
    for (const n of byThread.values()) total += n;
    return { total, threads: Object.fromEntries(byThread) };
  }

  @Get('threads/:id')
  async thread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { thread, role } = await this.chat.access(user, id);
    if (role === 'OBSERVER') await this.chat.recordObserve(user, id);
    const unread =
      role === 'OBSERVER'
        ? new Map<string, number>()
        : await this.chat.unreadByThread(user, [id]);
    const postable =
      role !== 'STAFF' ||
      (await this.chat.stillTeaches(user.sub, thread.studentId));
    return this.chat.toDto(thread, user, role, unread.get(id) ?? 0, postable);
  }

  /**
   * Messages in ascending order. No cursor: the latest `limit`. `after=<messageId>`:
   * newer than that message (polling). `before=<messageId>`: older history.
   * hasMore says whether more exist beyond the page in the direction asked.
   */
  @Get('threads/:id/messages')
  async messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(messagesQuerySchema)) q: MessagesQuery,
  ) {
    if (q.after && q.before)
      throw new BadRequestException('Use either after or before, not both');
    const { role } = await this.chat.access(user, id);
    if (role === 'OBSERVER') await this.chat.recordObserve(user, id);
    const cursorId = q.after ?? q.before;
    let where: Prisma.ChatMessageWhereInput = { threadId: id };
    if (cursorId) {
      const cursor = await this.prisma.chatMessage.findFirst({
        where: { id: cursorId, threadId: id },
        select: { id: true, createdAt: true },
      });
      if (!cursor) throw new BadRequestException('Unknown message cursor');
      const op = q.after ? 'gt' : 'lt';
      where = {
        threadId: id,
        OR: [
          { createdAt: { [op]: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { [op]: cursor.id } },
        ],
      };
    }
    const ascending = Boolean(q.after);
    const dir = ascending ? 'asc' : 'desc';
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: [{ createdAt: dir }, { id: dir }],
      take: q.limit + 1,
      select: messageSelect,
    });
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    if (!ascending) page.reverse();
    return {
      items: page.map((m) => ({
        id: m.id,
        body: m.body,
        senderId: m.senderId,
        senderName: m.sender?.name ?? null,
        mine: m.senderId === user.sub,
        createdAt: m.createdAt,
        readAt: m.readAt,
      })),
      hasMore,
    };
  }

  @Post('threads/:id/messages')
  @Permission('chat')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
  ) {
    await this.chat.forPosting(user, id);
    const message = await this.prisma.$transaction(async (tx) => {
      // Lock the thread so sends in one thread commit one at a time, and stamp
      // the message after the lock, strictly after the previous one. A message
      // is then never committed with an older createdAt than one a poller has
      // already seen, so `?after=` cannot skip it.
      const [locked] = await tx.$queryRaw<{ lastMessageAt: Date | null }[]>`
        SELECT "lastMessageAt" FROM "ChatThread" WHERE "id" = ${id} FOR UPDATE`;
      const now = Date.now();
      const prev = locked?.lastMessageAt?.getTime() ?? 0;
      const m = await tx.chatMessage.create({
        data: {
          threadId: id,
          senderId: user.sub,
          body: body.body,
          createdAt: new Date(Math.max(now, prev + 1)),
        },
        select: messageSelect,
      });
      await tx.chatThread.update({
        where: { id },
        data: { lastMessageAt: m.createdAt },
      });
      return m;
    });
    return {
      id: message.id,
      body: message.body,
      senderId: message.senderId,
      senderName: message.sender?.name ?? null,
      mine: true,
      createdAt: message.createdAt,
      readAt: message.readAt,
    };
  }

  /** Marks every message from the other side as read. Participants only. */
  @Post('threads/:id/read')
  @HttpCode(200)
  @Permission('chat')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { role } = await this.chat.access(user, id);
    if (role === 'OBSERVER')
      throw new ForbiddenException(
        'You can read this conversation but not mark it read',
      );
    const { count } = await this.prisma.chatMessage.updateMany({
      where: { threadId: id, ...unreadWhere(user.sub) },
      data: { readAt: new Date() },
    });
    return { marked: count };
  }
}
