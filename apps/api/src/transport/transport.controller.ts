import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Prisma, StudentStatus, VehicleType } from '@prisma/client';
import { z } from 'zod';
import {
  campusScope,
  SETUP_ROLES,
  STAFF_ROLES,
} from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import { CurrentUser, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { riderFee, TIME } from './transport-rules.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const phone = z
  .string()
  .trim()
  .regex(/^0\d{10}$/, 'Use an 11-digit number like 03001234567');
const optionalText = z.string().trim().max(80).nullable().optional();
const time = z.string().regex(TIME, 'Use HH:MM').nullable().optional();

const vehicleSchema = z.object({
  registrationNo: z.string().trim().toUpperCase().min(3).max(20),
  type: z.enum(VehicleType).default(VehicleType.VAN),
  capacity: z.number().int().min(1).max(100),
  driverName: z.string().trim().min(2).max(80),
  driverPhone: phone,
  driverCnic: optionalText,
  conductorName: optionalText,
  conductorPhone: phone.nullable().optional(),
  isActive: z.boolean().optional(),
});

const routeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  campusId: z.string().nullable().optional(),
  vehicleId: z.string().nullable().optional(),
  monthlyFee: z.number().int().min(0).max(100_000),
  isActive: z.boolean().optional(),
});

const stopsSchema = z.object({
  stops: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(2).max(80),
        pickupTime: time,
        dropTime: time,
        monthlyFee: z.number().int().min(0).max(100_000).nullable().optional(),
      }),
    )
    .max(60),
});

const assignSchema = z.object({
  studentId: z.string().min(1),
  routeId: z.string().min(1),
  stopId: z.string().nullable().optional(),
  startsOn: isoDate.optional(),
});

const endSchema = z.object({ endsOn: isoDate.optional() });

const name = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** School vans and buses, their routes and stops, and who rides them. */
@Controller('transport')
@RequiresFeature('transport')
export class TransportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----- Vehicles -----

  @Get('vehicles')
  @Roles(...STAFF_ROLES)
  vehicles(@CurrentUser() user: AuthUser) {
    return this.prisma.vehicle.findMany({
      where: { schoolId: user.schoolId },
      orderBy: [{ isActive: 'desc' }, { registrationNo: 'asc' }],
      include: {
        routes: { where: { isActive: true }, select: { id: true, name: true } },
      },
    });
  }

  @Post('vehicles')
  @Roles(...SETUP_ROLES)
  async addVehicle(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(vehicleSchema))
    body: z.infer<typeof vehicleSchema>,
  ) {
    const vehicle = await this.unique(
      () =>
        this.prisma.vehicle.create({
          data: { ...body, schoolId: user.schoolId },
        }),
      body.registrationNo,
    );
    await this.audit.record(
      user,
      'transport.vehicle.create',
      'Vehicle',
      vehicle.id,
      { after: vehicle },
    );
    return vehicle;
  }

  @Patch('vehicles/:id')
  @Roles(...SETUP_ROLES)
  async updateVehicle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(vehicleSchema.partial()))
    body: Partial<z.infer<typeof vehicleSchema>>,
  ) {
    const before = await this.prisma.vehicle.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!before) throw new NotFoundException('Vehicle not found');
    if (body.capacity !== undefined) {
      const busiest = await this.busiestRoute(id);
      if (busiest && body.capacity < busiest.riders) {
        throw new ConflictException(
          `${busiest.name} already has ${busiest.riders} riders in this vehicle.`,
        );
      }
    }
    const after = await this.unique(
      () => this.prisma.vehicle.update({ where: { id }, data: body }),
      body.registrationNo ?? before.registrationNo,
    );
    await this.audit.record(user, 'transport.vehicle.update', 'Vehicle', id, {
      before,
      after,
    });
    return after;
  }

  // ----- Routes -----

  /** Every route with its vehicle, stops, how full it is and what it bills a month. */
  @Get('routes')
  @Roles(...STAFF_ROLES)
  async routes(@CurrentUser() user: AuthUser) {
    const routes = await this.prisma.transportRoute.findMany({
      where: { schoolId: user.schoolId, ...this.campusFilter(user) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        campus: { select: { name: true } },
        vehicle: true,
        stops: { orderBy: { position: 'asc' } },
        assignments: { where: { endsOn: null }, select: { stopId: true } },
      },
    });
    return routes.map(({ assignments, ...r }) => ({
      ...r,
      riders: assignments.length,
      monthlyBilling: assignments.reduce(
        (sum, a) =>
          sum + riderFee(r, r.stops.find((s) => s.id === a.stopId) ?? null),
        0,
      ),
      stops: r.stops.map((s) => ({
        ...s,
        riders: assignments.filter((a) => a.stopId === s.id).length,
      })),
    }));
  }

  @Post('routes')
  @Roles(...SETUP_ROLES)
  async addRoute(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(routeSchema)) body: z.infer<typeof routeSchema>,
  ) {
    await this.checkRouteLinks(user, body);
    const route = await this.unique(
      () =>
        this.prisma.transportRoute.create({
          data: { ...body, schoolId: user.schoolId },
        }),
      body.name,
    );
    await this.audit.record(
      user,
      'transport.route.create',
      'TransportRoute',
      route.id,
      { after: route },
    );
    return route;
  }

  @Patch('routes/:id')
  @Roles(...SETUP_ROLES)
  async updateRoute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(routeSchema.partial()))
    body: Partial<z.infer<typeof routeSchema>>,
  ) {
    const before = await this.editableRoute(user, id);
    await this.checkRouteLinks(user, body);
    if (body.vehicleId) {
      const vehicle = await this.prisma.vehicle.findUniqueOrThrow({
        where: { id: body.vehicleId },
      });
      const riders = await this.prisma.transportAssignment.count({
        where: { routeId: id, endsOn: null },
      });
      if (riders > vehicle.capacity) {
        throw new ConflictException(
          `${vehicle.registrationNo} has ${vehicle.capacity} seats; this route has ${riders} riders.`,
        );
      }
    }
    if (body.isActive === false) {
      const riders = await this.prisma.transportAssignment.count({
        where: { routeId: id, endsOn: null },
      });
      if (riders)
        throw new ConflictException(
          `Move or stop the route's ${riders} riders before closing it.`,
        );
    }
    const after = await this.unique(
      () => this.prisma.transportRoute.update({ where: { id }, data: body }),
      body.name ?? before.name,
    );
    await this.audit.record(
      user,
      'transport.route.update',
      'TransportRoute',
      id,
      { before, after },
    );
    return after;
  }

  /**
   * Replaces a route's stops in the order given. Stops sent with an id are
   * kept (and their riders with them); a stop left out is removed, which is
   * refused while anyone is still picked up there.
   */
  @Put('routes/:id/stops')
  @Roles(...SETUP_ROLES)
  async setStops(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(stopsSchema)) body: z.infer<typeof stopsSchema>,
  ) {
    await this.editableRoute(user, id);
    const existing = await this.prisma.routeStop.findMany({
      where: { routeId: id },
      include: {
        _count: { select: { assignments: { where: { endsOn: null } } } },
      },
    });
    const keep = new Set(body.stops.flatMap((s) => (s.id ? [s.id] : [])));
    for (const s of body.stops) {
      if (s.id && !existing.some((e) => e.id === s.id))
        throw new BadRequestException('A stop is not on this route');
    }
    const removed = existing.filter((e) => !keep.has(e.id));
    const busy = removed.find((e) => e._count.assignments > 0);
    if (busy) {
      throw new ConflictException(
        `${busy._count.assignments} riders are picked up at ${busy.name}. Move them to another stop first.`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.routeStop.deleteMany({
        where: { id: { in: removed.map((r) => r.id) } },
      }),
      ...body.stops.map((s, position) => {
        const data = {
          name: s.name,
          position,
          pickupTime: s.pickupTime ?? null,
          dropTime: s.dropTime ?? null,
          monthlyFee: s.monthlyFee ?? null,
        };
        return s.id
          ? this.prisma.routeStop.update({ where: { id: s.id }, data })
          : this.prisma.routeStop.create({ data: { ...data, routeId: id } });
      }),
    ]);
    await this.audit.record(
      user,
      'transport.route.stops',
      'TransportRoute',
      id,
      { after: body.stops },
    );
    return this.prisma.routeStop.findMany({
      where: { routeId: id },
      orderBy: { position: 'asc' },
    });
  }

  /** A route's riders in pick-up order, with their parents' phone numbers: the driver's list. */
  @Get('routes/:id')
  @Roles(...STAFF_ROLES)
  async routeDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.route(user, id);
    const route = await this.prisma.transportRoute.findUniqueOrThrow({
      where: { id },
      include: {
        campus: { select: { name: true } },
        vehicle: true,
        stops: { orderBy: { position: 'asc' } },
        assignments: {
          where: { endsOn: null },
          include: {
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNo: true,
                enrollments: {
                  where: { status: 'ACTIVE' },
                  select: {
                    rollNo: true,
                    section: {
                      select: { name: true, class: { select: { name: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const phones = await guardianPhones(
      this.prisma,
      route.assignments.map((a) => a.studentId),
    );
    const position = new Map(route.stops.map((s) => [s.id, s.position]));
    const riders = route.assignments
      .map((a) => {
        const stop = route.stops.find((s) => s.id === a.stopId) ?? null;
        const e = a.student.enrollments[0];
        return {
          assignmentId: a.id,
          studentId: a.studentId,
          name: name(a.student),
          admissionNo: a.student.admissionNo,
          class: e ? `${e.section.class.name} ${e.section.name}` : null,
          stopId: a.stopId,
          stop: stop?.name ?? null,
          pickupTime: stop?.pickupTime ?? null,
          dropTime: stop?.dropTime ?? null,
          fee: riderFee(route, stop),
          since: iso(a.startsOn),
          phones: phones.get(a.studentId) ?? [],
        };
      })
      .sort(
        (a, b) =>
          (position.get(a.stopId ?? '') ?? 999) -
            (position.get(b.stopId ?? '') ?? 999) ||
          a.name.localeCompare(b.name),
      );
    const { assignments: _assignments, ...rest } = route;
    return { ...rest, riders };
  }

  // ----- Riders -----

  /** A student's current route and past ones. */
  @Get('students/:id')
  @Roles(...STAFF_ROLES)
  async student(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.studentInScope(user, id);
    const rows = await this.prisma.transportAssignment.findMany({
      where: { studentId: id },
      orderBy: { startsOn: 'desc' },
      include: { route: { include: { vehicle: true } }, stop: true },
    });
    const view = (a: (typeof rows)[number]) => ({
      id: a.id,
      routeId: a.routeId,
      route: a.route.name,
      stopId: a.stopId,
      stop: a.stop?.name ?? null,
      pickupTime: a.stop?.pickupTime ?? null,
      dropTime: a.stop?.dropTime ?? null,
      fee: riderFee(a.route, a.stop),
      vehicle: a.route.vehicle && {
        registrationNo: a.route.vehicle.registrationNo,
        driverName: a.route.vehicle.driverName,
        driverPhone: a.route.vehicle.driverPhone,
      },
      startsOn: iso(a.startsOn),
      endsOn: iso(a.endsOn),
    });
    const current = rows.find((r) => r.endsOn === null);
    return {
      current: current ? view(current) : null,
      history: rows.filter((r) => r !== current).map(view),
    };
  }

  /**
   * Puts a student on a route, or moves them to another route or stop. Any
   * current ride ends the day before the new one starts.
   */
  @Post('assignments')
  @Roles(...SETUP_ROLES)
  async assign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(assignSchema))
    body: z.infer<typeof assignSchema>,
  ) {
    const student = await this.studentInScope(user, body.studentId);
    if (student.status !== StudentStatus.ACTIVE)
      throw new BadRequestException('Only current students can use transport');
    const route = await this.route(user, body.routeId);
    if (!route.isActive)
      throw new BadRequestException(`${route.name} is closed`);
    const stop = body.stopId
      ? await this.prisma.routeStop.findFirst({
          where: { id: body.stopId, routeId: route.id },
        })
      : null;
    if (body.stopId && !stop)
      throw new BadRequestException('That stop is not on this route');
    const startsOn = body.startsOn ?? localToday();

    const current = await this.prisma.transportAssignment.findFirst({
      where: { studentId: student.id, endsOn: null },
    });
    if (current && current.startsOn.toISOString().slice(0, 10) > startsOn) {
      throw new BadRequestException(
        'The student already has a ride starting after that date',
      );
    }
    const sameRoute = current?.routeId === route.id;
    if (route.vehicleId && !sameRoute) {
      const vehicle = await this.prisma.vehicle.findUniqueOrThrow({
        where: { id: route.vehicleId },
      });
      const riders = await this.prisma.transportAssignment.count({
        where: { routeId: route.id, endsOn: null },
      });
      if (riders >= vehicle.capacity) {
        throw new ConflictException(
          `${route.name} is full: ${vehicle.registrationNo} has ${vehicle.capacity} seats and ${riders} riders.`,
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (current) {
        // Moving on the day a ride started replaces it rather than leaving a zero-day ride.
        if (current.startsOn.toISOString().slice(0, 10) === startsOn) {
          await tx.transportAssignment.delete({ where: { id: current.id } });
        } else {
          await tx.transportAssignment.update({
            where: { id: current.id },
            data: { endsOn: dayStart(daysBefore(startsOn, 1)) },
          });
        }
      }
      return tx.transportAssignment.create({
        data: {
          schoolId: user.schoolId,
          studentId: student.id,
          routeId: route.id,
          stopId: stop?.id ?? null,
          startsOn: dayStart(startsOn),
        },
      });
    });
    await this.audit.record(user, 'transport.assign', 'Student', student.id, {
      before: current && { routeId: current.routeId, stopId: current.stopId },
      after: { routeId: route.id, stopId: stop?.id ?? null, startsOn },
    });
    return created;
  }

  /** Stops a student's transport; they are billed for the month it ends in. */
  @Post('assignments/:id/end')
  @Roles(...SETUP_ROLES)
  async end(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endSchema)) body: z.infer<typeof endSchema>,
  ) {
    const a = await this.prisma.transportAssignment.findFirst({
      where: { id, schoolId: user.schoolId, endsOn: null },
    });
    if (!a) throw new NotFoundException('No current ride to stop');
    await this.studentInScope(user, a.studentId);
    const endsOn = body.endsOn ?? localToday();
    if (endsOn < a.startsOn.toISOString().slice(0, 10))
      throw new BadRequestException('It ends before it started');
    const after = await this.prisma.transportAssignment.update({
      where: { id },
      data: { endsOn: dayStart(endsOn) },
    });
    await this.audit.record(user, 'transport.end', 'Student', a.studentId, {
      after: { routeId: a.routeId, endsOn },
    });
    return after;
  }

  // ----- Helpers -----

  /** Campus heads see their campus's routes and the school-wide ones. */
  private campusFilter(user: AuthUser): Prisma.TransportRouteWhereInput {
    const scope = campusScope(user);
    return scope
      ? { OR: [{ campusId: null }, { campusId: { in: scope } }] }
      : {};
  }

  /** A route campus heads can change: one at their own campus. */
  private async editableRoute(user: AuthUser, id: string) {
    const route = await this.route(user, id);
    if (campusScope(user) && route.campusId === null) {
      throw new ForbiddenException(
        'Only school-wide staff can change a route for every campus',
      );
    }
    return route;
  }

  private async route(user: AuthUser, id: string) {
    const route = await this.prisma.transportRoute.findFirst({
      where: { id, schoolId: user.schoolId, ...this.campusFilter(user) },
    });
    if (!route) throw new NotFoundException('Route not found');
    return route;
  }

  private async studentInScope(user: AuthUser, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const scope = campusScope(user);
    if (scope && !scope.includes(student.campusId))
      throw new ForbiddenException('Student is at another campus');
    return student;
  }

  private async checkRouteLinks(
    user: AuthUser,
    body: { campusId?: string | null; vehicleId?: string | null },
  ) {
    const scope = campusScope(user);
    if (body.campusId) {
      const campus = await this.prisma.campus.findFirst({
        where: { id: body.campusId, schoolId: user.schoolId },
      });
      if (!campus) throw new BadRequestException('No such campus');
      if (scope && !scope.includes(body.campusId))
        throw new ForbiddenException('That campus is not yours to manage');
    } else if (scope && body.campusId === null) {
      throw new ForbiddenException(
        'Only school-wide staff can make a route for every campus',
      );
    }
    if (body.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: body.vehicleId, schoolId: user.schoolId },
      });
      if (!vehicle) throw new BadRequestException('No such vehicle');
    }
  }

  private async busiestRoute(vehicleId: string) {
    const routes = await this.prisma.transportRoute.findMany({
      where: { vehicleId },
      select: {
        name: true,
        _count: { select: { assignments: { where: { endsOn: null } } } },
      },
    });
    return routes
      .map((r) => ({ name: r.name, riders: r._count.assignments }))
      .sort((a, b) => b.riders - a.riders)[0];
  }

  private async unique<T>(write: () => Promise<T>, label: string): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(`${label} already exists`);
      }
      throw error;
    }
  }
}
