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
  Query,
} from '@nestjs/common';
import { PosMovementType, PosPayment, Prisma, StudentStatus } from '@prisma/client';
import { z } from 'zod';
import { campusScope, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { daysBefore, localDate, localToday, startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { studentSearchWhere } from '../common/student-search.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { documentNumber, mergeLines, owed, rollup, saleTotals, stockAfter } from './pos-rules.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const rupees = z.number().int().min(0).max(10_000_000);
const qty = z.number().int().min(1).max(100_000);

const itemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  barcode: z.string().trim().min(1).max(40).nullable().optional(),
  category: text(60),
  brand: text(60),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  costPrice: rupees.default(0),
  salePrice: rupees,
  reorderLevel: z.number().int().min(0).max(100_000).default(0),
});
const newItemSchema = itemSchema.extend({
  openingQty: z.number().int().min(0).max(100_000).default(0),
  warehouseId: z.string().optional(),
});
const itemPatchSchema = itemSchema.partial().extend({ active: z.boolean().optional() });

const vendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: text(30),
  address: text(200),
  notes: text(300),
});
const vendorPatchSchema = vendorSchema.partial().extend({ active: z.boolean().optional() });

const warehouseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  campusId: z.string().nullable().optional(),
});
const warehousePatchSchema = warehouseSchema.partial().extend({ active: z.boolean().optional() });

const saleSchema = z
  .object({
    warehouseId: z.string(),
    lines: z.array(z.object({ itemId: z.string(), qty })).min(1).max(100),
    discount: rupees.default(0),
    payment: z.nativeEnum(PosPayment).default(PosPayment.CASH),
    studentId: z.string().optional(),
    customerName: text(80),
  })
  .refine((b) => (b.payment === PosPayment.ON_ACCOUNT) === Boolean(b.studentId), 'A student is needed for a sale on account, and only then');

const purchaseSchema = z.object({
  vendorId: z.string(),
  warehouseId: z.string(),
  purchasedOn: isoDate.optional(),
  lines: z.array(z.object({ itemId: z.string(), qty, unitCost: rupees })).min(1).max(100),
  paid: rupees.default(0),
  note: text(300),
});

const adjustSchema = z.object({
  itemId: z.string(),
  warehouseId: z.string(),
  change: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'Enter how many to add or remove'),
  reason: z.string().trim().min(2).max(200),
});
const transferSchema = z
  .object({ itemId: z.string(), fromId: z.string(), toId: z.string(), qty })
  .refine((b) => b.fromId !== b.toId, 'Choose two different stores');

const REPORTS = [
  'dashboard',
  'stock',
  'warehouse-stock',
  'profit',
  'product-sales',
  'receiving',
  'receivables',
  'payables',
  'stock-transactions',
] as const;

const saleInclude = {
  lines: true,
  warehouse: { select: { name: true } },
} satisfies Prisma.PosSaleInclude;

/** The canteen and school shop: products, stock in each store, sales, purchases and vendors. */
@Controller('pos')
@Permission('pos')
@RequiresFeature('pos')
@Roles(...STAFF_ROLES)
export class PosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----- Stores -----

  @Get('warehouses')
  async warehouses(@CurrentUser() user: AuthUser) {
    // A school starts with one store so the counter works on day one.
    const count = await this.prisma.posWarehouse.count({ where: { schoolId: user.schoolId } });
    if (!count) {
      await this.prisma.posWarehouse.createMany({
        data: [{ schoolId: user.schoolId, name: 'Main store' }],
        skipDuplicates: true,
      });
    }
    return this.prisma.posWarehouse.findMany({
      where: { schoolId: user.schoolId, ...this.visible(user) },
      orderBy: { name: 'asc' },
    });
  }

  @Post('warehouses')
  @Roles(...SETUP_ROLES)
  async addWarehouse(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(warehouseSchema)) body: z.infer<typeof warehouseSchema>,
  ) {
    await this.checkCampus(user, body.campusId);
    const w = await this.prisma.posWarehouse.create({ data: { ...body, schoolId: user.schoolId } }).catch(uniqueName('store'));
    await this.audit.record(user, 'pos.warehouse.create', 'PosWarehouse', w.id, { after: body });
    return w;
  }

  @Patch('warehouses/:id')
  @Roles(...SETUP_ROLES)
  async updateWarehouse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(warehousePatchSchema)) body: z.infer<typeof warehousePatchSchema>,
  ) {
    const before = await this.warehouse(user, id, false);
    if (body.campusId !== undefined) await this.checkCampus(user, body.campusId);
    const after = await this.prisma.posWarehouse.update({ where: { id }, data: body }).catch(uniqueName('store'));
    await this.audit.record(user, 'pos.warehouse.update', 'PosWarehouse', id, { before, after });
    return after;
  }

  // ----- Products -----

  @Get('items')
  async items(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('all') all?: string,
  ) {
    const q = search?.trim();
    const items = await this.prisma.posItem.findMany({
      where: {
        schoolId: user.schoolId,
        ...(all === '1' ? {} : { active: true }),
        ...(q
          ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { barcode: q }, { category: { contains: q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 500,
      include: { stock: { where: { warehouse: this.visible(user) } } },
    });
    return items.map(({ stock, ...item }) => ({
      ...item,
      onHand: stock.filter((s) => !warehouseId || s.warehouseId === warehouseId).reduce((n, s) => n + s.qty, 0),
    }));
  }

  @Post('items')
  async addItem(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(newItemSchema)) body: z.infer<typeof newItemSchema>,
  ) {
    const { openingQty, warehouseId, ...data } = body;
    if (openingQty > 0 && !warehouseId) throw new BadRequestException('Choose the store the opening stock is in');
    const warehouse = openingQty > 0 ? await this.warehouse(user, warehouseId!) : null;
    const item = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.schoolId);
      const created = await tx.posItem.create({ data: { ...data, schoolId: user.schoolId } }).catch(uniqueName('barcode'));
      if (warehouse) {
        await this.move(tx, user, { itemId: created.id, warehouseId: warehouse.id, change: openingQty, type: PosMovementType.OPENING });
      }
      return created;
    });
    await this.audit.record(user, 'pos.item.create', 'PosItem', item.id, { after: body });
    return item;
  }

  @Patch('items/:id')
  async updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(itemPatchSchema)) body: z.infer<typeof itemPatchSchema>,
  ) {
    const before = await this.prisma.posItem.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new NotFoundException('Product not found');
    const after = await this.prisma.posItem.update({ where: { id }, data: body }).catch(uniqueName('barcode'));
    await this.audit.record(user, 'pos.item.update', 'PosItem', id, { before, after });
    return after;
  }

  @Get('categories')
  async categories(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.posItem.groupBy({
      by: ['category'],
      where: { schoolId: user.schoolId, category: { not: null } },
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => r.category);
  }

  // ----- Vendors -----

  @Get('vendors')
  async vendors(@CurrentUser() user: AuthUser) {
    const [vendors, purchases] = await Promise.all([
      this.prisma.posVendor.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } }),
      this.prisma.posPurchase.findMany({ where: { schoolId: user.schoolId }, select: { vendorId: true, total: true, paid: true } }),
    ]);
    const owing = new Map(rollup(purchases, (p) => p.vendorId, { owed: (p) => owed(p.total, p.paid) }).map((r) => [r.key, r.owed]));
    return vendors.map((v) => ({ ...v, owed: owing.get(v.id) ?? 0 }));
  }

  @Post('vendors')
  async addVendor(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(vendorSchema)) body: z.infer<typeof vendorSchema>,
  ) {
    const v = await this.prisma.posVendor.create({ data: { ...body, schoolId: user.schoolId } }).catch(uniqueName('vendor'));
    await this.audit.record(user, 'pos.vendor.create', 'PosVendor', v.id, { after: body });
    return v;
  }

  @Patch('vendors/:id')
  async updateVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(vendorPatchSchema)) body: z.infer<typeof vendorPatchSchema>,
  ) {
    const before = await this.prisma.posVendor.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!before) throw new NotFoundException('Vendor not found');
    const after = await this.prisma.posVendor.update({ where: { id }, data: body }).catch(uniqueName('vendor'));
    await this.audit.record(user, 'pos.vendor.update', 'PosVendor', id, { before, after });
    return after;
  }

  // ----- Stock -----

  /** What is on the shelves: one row per product and store. */
  @Get('stock')
  async stock(@CurrentUser() user: AuthUser, @Query('warehouseId') warehouseId?: string) {
    const rows = await this.prisma.posStock.findMany({
      where: { item: { schoolId: user.schoolId }, warehouse: this.visible(user), ...(warehouseId ? { warehouseId } : {}) },
      include: { item: true, warehouse: { select: { name: true } } },
      orderBy: { item: { name: 'asc' } },
      take: 2000,
    });
    return rows.map((r) => ({
      itemId: r.itemId,
      name: r.item.name,
      category: r.item.category,
      warehouseId: r.warehouseId,
      warehouse: r.warehouse.name,
      qty: r.qty,
      reorderLevel: r.item.reorderLevel,
      low: r.qty <= r.item.reorderLevel,
      value: r.qty * r.item.costPrice,
    }));
  }

  @Post('stock/adjust')
  async adjust(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(adjustSchema)) body: z.infer<typeof adjustSchema>,
  ) {
    const warehouse = await this.warehouse(user, body.warehouseId);
    await this.item(user, body.itemId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.schoolId);
      await this.move(tx, user, {
        itemId: body.itemId,
        warehouseId: warehouse.id,
        change: body.change,
        type: PosMovementType.ADJUSTMENT,
        note: body.reason,
      });
    });
    await this.audit.record(user, 'pos.stock.adjust', 'PosItem', body.itemId, { after: body });
    return { ok: true };
  }

  @Post('stock/transfer')
  async transfer(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(transferSchema)) body: z.infer<typeof transferSchema>,
  ) {
    const [from, to] = await Promise.all([this.warehouse(user, body.fromId), this.warehouse(user, body.toId)]);
    await this.item(user, body.itemId);
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.schoolId);
      const note = `${from.name} to ${to.name}`;
      await this.move(tx, user, { itemId: body.itemId, warehouseId: from.id, change: -body.qty, type: PosMovementType.TRANSFER_OUT, note });
      await this.move(tx, user, { itemId: body.itemId, warehouseId: to.id, change: body.qty, type: PosMovementType.TRANSFER_IN, note });
    });
    await this.audit.record(user, 'pos.stock.transfer', 'PosItem', body.itemId, { after: body });
    return { ok: true };
  }

  // ----- Sales -----

  /** Students to put a sale on account for. */
  @Get('customers')
  async customers(@CurrentUser() user: AuthUser, @Query('search') search = '') {
    if (search.trim().length < 2) return [];
    const scope = campusScope(user);
    const students = await this.prisma.student.findMany({
      where: {
        schoolId: user.schoolId,
        status: StudentStatus.ACTIVE,
        ...(scope ? { campusId: { in: scope } } : {}),
        ...studentSearchWhere(search),
      },
      take: 15,
      orderBy: { firstName: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        enrollments: { where: { status: 'ACTIVE' }, select: { section: { select: { name: true, class: { select: { name: true } } } } } },
      },
    });
    const tabs = await this.prisma.posSale.groupBy({
      by: ['studentId'],
      where: { schoolId: user.schoolId, payment: PosPayment.ON_ACCOUNT, settledAt: null, voidedAt: null, studentId: { in: students.map((s) => s.id) } },
      _sum: { total: true },
    });
    return students.map((s) => ({
      id: s.id,
      name: [s.firstName, s.lastName].filter(Boolean).join(' '),
      admissionNo: s.admissionNo,
      class: s.enrollments[0] ? `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}` : null,
      onAccount: tabs.find((t) => t.studentId === s.id)?._sum.total ?? 0,
    }));
  }

  @Post('sales')
  async sell(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(saleSchema)) body: z.infer<typeof saleSchema>,
  ) {
    const warehouse = await this.warehouse(user, body.warehouseId);
    if (body.studentId) await this.student(user, body.studentId);
    const wanted = mergeLines(body.lines);
    const items = await this.prisma.posItem.findMany({
      where: { schoolId: user.schoolId, id: { in: wanted.map((l) => l.itemId) }, active: true },
    });
    const lines = wanted.map((l) => {
      const item = items.find((i) => i.id === l.itemId);
      if (!item) throw new BadRequestException('A product on this sale is missing or switched off');
      return { itemId: item.id, itemName: item.name, qty: l.qty, unitPrice: item.salePrice, unitCost: item.costPrice };
    });
    const totals = saleTotals(lines, body.discount);
    if (!totals) throw new BadRequestException('The discount is more than the sale');

    const sale = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.schoolId);
      const count = await tx.posSale.count({ where: { schoolId: user.schoolId } });
      const created = await tx.posSale.create({
        data: {
          schoolId: user.schoolId,
          number: documentNumber('S', count),
          warehouseId: warehouse.id,
          payment: body.payment,
          studentId: body.studentId ?? null,
          customerName: body.customerName ?? null,
          discount: body.discount,
          ...totals,
          cashierId: user.sub,
          lines: { create: lines },
        },
        include: saleInclude,
      });
      for (const l of lines) {
        await this.move(tx, user, { itemId: l.itemId, warehouseId: warehouse.id, change: -l.qty, type: PosMovementType.SALE, refId: created.id });
      }
      await this.audit.record(user, 'pos.sale', 'PosSale', created.id, { after: { number: created.number, total: created.total, payment: created.payment } }, tx);
      return created;
    });
    return sale;
  }

  @Get('sales')
  async sales(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('studentId') studentId?: string,
  ) {
    const range = this.range(from, to, 0);
    const sales = await this.prisma.posSale.findMany({
      where: { schoolId: user.schoolId, warehouse: this.visible(user), createdAt: range, ...(studentId ? { studentId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: saleInclude,
    });
    return this.withStudents(sales);
  }

  @Post('sales/:id/void')
  async voidSale(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ reason: z.string().trim().min(2).max(200) }))) body: { reason: string },
  ) {
    const sale = await this.prisma.posSale.findFirst({ where: { id, schoolId: user.schoolId }, include: { lines: true } });
    if (!sale) throw new NotFoundException('Sale not found');
    await this.warehouse(user, sale.warehouseId, false);
    if (sale.voidedAt) throw new ConflictException('This sale is already cancelled');
    if (sale.settledAt) throw new ConflictException('This sale was already paid from the student’s account');
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.schoolId);
      await tx.posSale.update({ where: { id }, data: { voidedAt: new Date(), voidReason: body.reason } });
      for (const l of sale.lines) {
        await this.move(tx, user, { itemId: l.itemId, warehouseId: sale.warehouseId, change: l.qty, type: PosMovementType.SALE_VOID, refId: id, note: body.reason });
      }
      await this.audit.record(user, 'pos.sale.void', 'PosSale', id, { after: { number: sale.number, reason: body.reason } }, tx);
    });
    return { ok: true };
  }

  /** The student paid their tab: every open sale on their account is marked paid. */
  @Post('accounts/settle')
  async settle(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(z.object({ studentId: z.string() }))) body: { studentId: string },
  ) {
    await this.student(user, body.studentId);
    const where = { schoolId: user.schoolId, studentId: body.studentId, payment: PosPayment.ON_ACCOUNT, settledAt: null, voidedAt: null };
    const open = await this.prisma.posSale.aggregate({ where, _sum: { total: true }, _count: true });
    if (!open._count) throw new ConflictException('Nothing is owed on this account');
    await this.prisma.posSale.updateMany({ where, data: { settledAt: new Date() } });
    const amount = open._sum.total ?? 0;
    await this.audit.record(user, 'pos.account.settle', 'Student', body.studentId, { after: { amount, sales: open._count } });
    return { amount, sales: open._count };
  }

  // ----- Purchases -----

  @Get('purchases')
  async purchases(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const range = this.range(from, to, 90);
    return this.prisma.posPurchase.findMany({
      where: { schoolId: user.schoolId, warehouse: this.visible(user), createdAt: range },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { vendor: { select: { name: true } }, warehouse: { select: { name: true } }, lines: true },
    });
  }

  @Post('purchases')
  async buy(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(purchaseSchema)) body: z.infer<typeof purchaseSchema>,
  ) {
    const warehouse = await this.warehouse(user, body.warehouseId);
    const vendor = await this.prisma.posVendor.findFirst({ where: { id: body.vendorId, schoolId: user.schoolId, active: true } });
    if (!vendor) throw new BadRequestException('Choose a vendor');
    const ids = [...new Set(body.lines.map((l) => l.itemId))];
    const found = await this.prisma.posItem.count({ where: { schoolId: user.schoolId, id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('A product on this purchase was not found');
    const total = body.lines.reduce((n, l) => n + l.qty * l.unitCost, 0);
    if (body.paid > total) throw new BadRequestException('You cannot pay more than the purchase costs');

    const purchase = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, user.schoolId);
      const count = await tx.posPurchase.count({ where: { schoolId: user.schoolId } });
      const created = await tx.posPurchase.create({
        data: {
          schoolId: user.schoolId,
          number: documentNumber('PUR', count, 4),
          vendorId: vendor.id,
          warehouseId: warehouse.id,
          purchasedOn: new Date(`${body.purchasedOn ?? localToday()}T00:00:00.000Z`),
          total,
          paid: body.paid,
          note: body.note ?? null,
          createdById: user.sub,
          lines: { create: body.lines },
        },
        include: { vendor: { select: { name: true } }, lines: true },
      });
      for (const l of body.lines) {
        await this.move(tx, user, { itemId: l.itemId, warehouseId: warehouse.id, change: l.qty, type: PosMovementType.PURCHASE, unitCost: l.unitCost, refId: created.id });
        // shortcut: profit uses the latest purchase cost, not a moving average; upgrade if costs swing a lot.
        await tx.posItem.update({ where: { id: l.itemId }, data: { costPrice: l.unitCost } });
      }
      await this.audit.record(user, 'pos.purchase', 'PosPurchase', created.id, { after: { number: created.number, total, paid: body.paid } }, tx);
      return created;
    });
    return purchase;
  }

  @Post('purchases/:id/pay')
  async payVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ amount: rupees.refine((n) => n > 0, 'Enter an amount') }))) body: { amount: number },
  ) {
    const p = await this.prisma.posPurchase.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!p) throw new NotFoundException('Purchase not found');
    await this.warehouse(user, p.warehouseId, false);
    // The guard in the WHERE keeps two simultaneous payments from overpaying.
    const done = await this.prisma.posPurchase.updateMany({
      where: { id, paid: { lte: p.total - body.amount } },
      data: { paid: { increment: body.amount } },
    });
    if (!done.count) throw new ConflictException(`Only Rs ${owed(p.total, p.paid)} is still owed on ${p.number}`);
    await this.audit.record(user, 'pos.purchase.pay', 'PosPurchase', id, { after: { amount: body.amount } });
    return this.prisma.posPurchase.findUnique({ where: { id }, include: { vendor: { select: { name: true } }, lines: true } });
  }

  // ----- Reports -----

  @Get('reports/:kind')
  async report(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!(REPORTS as readonly string[]).includes(kind)) throw new NotFoundException('No such report');
    const school = user.schoolId;
    const wh = this.visible(user);
    const createdAt = this.range(from, to, 30);

    switch (kind as (typeof REPORTS)[number]) {
      case 'dashboard': {
        const today = startOfLocalDay(localToday());
        const month = startOfLocalDay(`${localToday().slice(0, 8)}01`);
        const [todaySales, monthSales, stock, tabs, purchases] = await Promise.all([
          this.salesBetween(school, wh, { gte: today }),
          this.salesBetween(school, wh, { gte: month }),
          this.prisma.posStock.findMany({ where: { item: { schoolId: school, active: true }, warehouse: wh }, include: { item: true } }),
          this.prisma.posSale.aggregate({ where: { schoolId: school, warehouse: wh, payment: PosPayment.ON_ACCOUNT, settledAt: null, voidedAt: null }, _sum: { total: true } }),
          this.prisma.posPurchase.findMany({ where: { schoolId: school, warehouse: wh }, select: { total: true, paid: true } }),
        ]);
        const figures = (sales: typeof todaySales) => ({
          sales: sales.length,
          revenue: sales.reduce((n, s) => n + s.total, 0),
          profit: sales.reduce((n, s) => n + this.profit(s), 0),
        });
        return {
          today: figures(todaySales),
          month: figures(monthSales),
          stockValue: stock.reduce((n, s) => n + s.qty * s.item.costPrice, 0),
          lowStock: stock.filter((s) => s.qty <= s.item.reorderLevel).length,
          receivables: tabs._sum.total ?? 0,
          payables: purchases.reduce((n, p) => n + owed(p.total, p.paid), 0),
        };
      }
      case 'stock': {
        const rows = await this.prisma.posItem.findMany({
          where: { schoolId: school, active: true },
          include: { stock: { where: { warehouse: wh } } },
          orderBy: { name: 'asc' },
          take: 1000,
        });
        return rows.map((i) => {
          const onHand = i.stock.reduce((n, s) => n + s.qty, 0);
          return { name: i.name, category: i.category, onHand, reorderLevel: i.reorderLevel, low: onHand <= i.reorderLevel, costPrice: i.costPrice, salePrice: i.salePrice, value: onHand * i.costPrice };
        });
      }
      case 'warehouse-stock': {
        return rollup(
          await this.prisma.posStock.findMany({ where: { item: { schoolId: school }, warehouse: wh, qty: { gt: 0 } }, include: { item: true, warehouse: true } }),
          (s) => s.warehouse.name,
          { products: () => 1, units: (s) => s.qty, value: (s) => s.qty * s.item.costPrice },
        ).map(({ key, ...r }) => ({ warehouse: key, ...r }));
      }
      case 'profit': {
        const sales = await this.salesBetween(school, wh, createdAt);
        return rollup(sales, (s) => localDate(s.createdAt), { sales: () => 1, revenue: (s) => s.total, profit: (s) => this.profit(s) })
          .sort((a, b) => a.key.localeCompare(b.key))
          .map(({ key, ...r }) => ({ day: key, ...r }));
      }
      case 'product-sales': {
        const sales = await this.salesBetween(school, wh, createdAt);
        return rollup(
          sales.flatMap((s) => s.lines),
          (l) => l.itemName,
          { qty: (l) => l.qty, revenue: (l) => l.qty * l.unitPrice, profit: (l) => l.qty * (l.unitPrice - l.unitCost) },
        )
          .sort((a, b) => b.revenue - a.revenue)
          .map(({ key, ...r }) => ({ product: key, ...r }));
      }
      case 'receiving': {
        const rows = await this.prisma.posPurchase.findMany({
          where: { schoolId: school, warehouse: wh, createdAt },
          orderBy: { createdAt: 'desc' },
          take: 1000,
          include: { vendor: { select: { name: true } }, warehouse: { select: { name: true } } },
        });
        return rows.map((p) => ({ number: p.number, on: p.purchasedOn.toISOString().slice(0, 10), vendor: p.vendor.name, warehouse: p.warehouse.name, total: p.total, paid: p.paid, owed: owed(p.total, p.paid) }));
      }
      case 'receivables': {
        const sales = await this.prisma.posSale.findMany({
          where: { schoolId: school, warehouse: wh, payment: PosPayment.ON_ACCOUNT, settledAt: null, voidedAt: null },
          select: { studentId: true, total: true, createdAt: true },
        });
        const students = await this.prisma.student.findMany({
          where: { id: { in: [...new Set(sales.map((s) => s.studentId!))] } },
          select: { id: true, firstName: true, lastName: true, admissionNo: true },
        });
        return rollup(sales, (s) => s.studentId!, { sales: () => 1, amount: (s) => s.total })
          .map((r) => {
            const st = students.find((s) => s.id === r.key);
            return { student: st ? [st.firstName, st.lastName].filter(Boolean).join(' ') : r.key, admissionNo: st?.admissionNo ?? null, sales: r.sales, amount: r.amount };
          })
          .sort((a, b) => b.amount - a.amount);
      }
      case 'payables': {
        const rows = await this.prisma.posPurchase.findMany({
          where: { schoolId: school, warehouse: wh },
          select: { total: true, paid: true, vendor: { select: { name: true } } },
        });
        return rollup(rows, (p) => p.vendor.name, { purchases: () => 1, total: (p) => p.total, owed: (p) => owed(p.total, p.paid) })
          .filter((r) => r.owed > 0)
          .sort((a, b) => b.owed - a.owed)
          .map(({ key, ...r }) => ({ vendor: key, ...r }));
      }
      case 'stock-transactions': {
        const rows = await this.prisma.posMovement.findMany({
          where: { schoolId: school, warehouse: wh, createdAt },
          orderBy: { createdAt: 'desc' },
          take: 1000,
          include: { item: { select: { name: true } }, warehouse: { select: { name: true } } },
        });
        return rows.map((m) => ({ at: m.createdAt.toISOString(), product: m.item.name, warehouse: m.warehouse.name, type: m.type, qty: m.qty, note: m.note }));
      }
    }
  }

  // ----- Helpers -----

  /** Stores this user may use: school-wide ones, and those on their campuses. */
  private visible(user: AuthUser): Prisma.PosWarehouseWhereInput {
    const scope = campusScope(user);
    return scope ? { OR: [{ campusId: null }, { campusId: { in: scope } }] } : {};
  }

  private async warehouse(user: AuthUser, id: string, mustBeActive = true) {
    const w = await this.prisma.posWarehouse.findFirst({
      where: { id, schoolId: user.schoolId, ...(mustBeActive ? { active: true } : {}) },
    });
    if (!w) throw new NotFoundException('Store not found');
    const scope = campusScope(user);
    if (scope && w.campusId && !scope.includes(w.campusId)) throw new ForbiddenException('That store belongs to another campus');
    return w;
  }

  private async item(user: AuthUser, id: string) {
    const item = await this.prisma.posItem.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!item) throw new NotFoundException('Product not found');
    return item;
  }

  private async student(user: AuthUser, id: string) {
    const scope = campusScope(user);
    const s = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId, status: StudentStatus.ACTIVE, ...(scope ? { campusId: { in: scope } } : {}) },
      select: { id: true },
    });
    if (!s) throw new BadRequestException('Student not found');
  }

  private async checkCampus(user: AuthUser, campusId?: string | null) {
    const scope = campusScope(user);
    if (scope && (!campusId || !scope.includes(campusId))) throw new ForbiddenException('That campus is not yours to manage');
    if (!campusId) return;
    const campus = await this.prisma.campus.findFirst({ where: { id: campusId, schoolId: user.schoolId } });
    if (!campus) throw new BadRequestException('No such campus');
  }

  /** One stock change at a time per school, so counts and document numbers never race. */
  private lock(tx: Prisma.TransactionClient, schoolId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos:${schoolId}`}))`;
  }

  /** Changes a product's count in a store and writes the movement; refuses to go below zero. */
  private async move(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    m: { itemId: string; warehouseId: string; change: number; type: PosMovementType; unitCost?: number; refId?: string; note?: string },
  ) {
    const key = { itemId_warehouseId: { itemId: m.itemId, warehouseId: m.warehouseId } };
    const current = await tx.posStock.findUnique({ where: key });
    const next = stockAfter(current?.qty ?? 0, m.change);
    if (next === null) {
      const item = await tx.posItem.findUnique({ where: { id: m.itemId }, select: { name: true } });
      throw new ConflictException(`Only ${current?.qty ?? 0} of ${item?.name ?? 'this product'} in stock`);
    }
    await tx.posStock.upsert({
      where: key,
      create: { itemId: m.itemId, warehouseId: m.warehouseId, qty: next },
      update: { qty: next },
    });
    await tx.posMovement.create({
      data: { schoolId: user.schoolId, itemId: m.itemId, warehouseId: m.warehouseId, type: m.type, qty: m.change, unitCost: m.unitCost, refId: m.refId, note: m.note, userId: user.sub },
    });
  }

  /** From/to days (inclusive) as a createdAt range; `fallbackDays` back from today when `from` is left out. */
  private range(from?: string, to?: string, fallbackDays = 30): Prisma.DateTimeFilter {
    const today = localToday();
    const start = from ?? daysBefore(today, fallbackDays);
    if (!isoDate.safeParse(start).success || (to && !isoDate.safeParse(to).success)) throw new BadRequestException('Use YYYY-MM-DD dates');
    return { gte: startOfLocalDay(start), lt: startOfLocalDay(daysBefore(to ?? today, -1)) };
  }

  private salesBetween(schoolId: string, warehouse: Prisma.PosWarehouseWhereInput, createdAt: Prisma.DateTimeFilter) {
    return this.prisma.posSale.findMany({
      where: { schoolId, warehouse, voidedAt: null, createdAt },
      include: { lines: true },
      take: 5000,
    });
  }

  /** What a sale earned after the goods cost and any discount. */
  private profit(s: { discount: number; lines: { qty: number; unitPrice: number; unitCost: number }[] }) {
    return s.lines.reduce((n, l) => n + l.qty * (l.unitPrice - l.unitCost), 0) - s.discount;
  }

  private async withStudents<T extends { studentId: string | null }>(sales: T[]) {
    const ids = [...new Set(sales.map((s) => s.studentId).filter((id): id is string => Boolean(id)))];
    const students = ids.length
      ? await this.prisma.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    return sales.map((s) => {
      const st = students.find((x) => x.id === s.studentId);
      return { ...s, studentName: st ? [st.firstName, st.lastName].filter(Boolean).join(' ') : null };
    });
  }
}

/** Turns a unique-constraint failure into a message people can act on. */
const uniqueName = (what: string) => (e: unknown): never => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictException(`That ${what} is already in use`);
  }
  throw e;
};
