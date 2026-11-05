// A school canteen and shop: a few weeks of buying, restocking the counter and selling.
import { randomUUID } from 'node:crypto';
import { PosMovementType, PosPayment, type Prisma, type PrismaClient } from '@prisma/client';
import { documentNumber, stockAfter } from '../../src/pos/pos-rules.js';
import type { Random } from './random.js';

// name, category, cost, price, sold per day at the counter (average)
const PRODUCTS: [string, string, number, number, number][] = [
  ['Samosa', 'Snacks', 18, 30, 40],
  ['Chicken roll', 'Snacks', 70, 120, 18],
  ['Fries', 'Snacks', 45, 80, 14],
  ['Biscuit pack', 'Snacks', 20, 30, 25],
  ['Chips', 'Snacks', 35, 50, 30],
  ['Sandwich', 'Meals', 90, 150, 12],
  ['Chicken biryani plate', 'Meals', 130, 200, 10],
  ['Juice box', 'Drinks', 40, 60, 28],
  ['Cold drink 345ml', 'Drinks', 55, 80, 22],
  ['Water bottle', 'Drinks', 30, 50, 24],
  ['Notebook', 'Stationery', 70, 110, 6],
  ['Pencil box', 'Stationery', 90, 140, 3],
  ['Ball pen', 'Stationery', 8, 15, 12],
  ['School tie', 'Uniform', 250, 400, 1],
];

const VENDORS = [
  ['Al-Madina Traders', '0300-5551201', 'Snacks and drinks'],
  ['Punjab Bakers', '0321-5551202', 'Daily bakery'],
  ['Zaman Stationers', '0333-5551203', 'Stationery and uniform'],
] as const;

const vendorFor = (category: string) => (category === 'Stationery' || category === 'Uniform' ? 2 : category === 'Meals' ? 1 : category === 'Snacks' ? 1 : 0);

export async function seedPos(
  prisma: PrismaClient,
  rng: Random,
  o: { schoolId: string; cashierId: string; studentIds: string[]; schoolDays: string[]; today: string },
) {
  const { schoolId } = o;
  const days = o.schoolDays.slice(-45); // roughly two months of trading
  const at = (day: string, hour: number, minute: number) => new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:00`);

  const warehouses = (['Canteen counter', 'Store room'] as const).map((name) => ({ id: randomUUID(), schoolId, name }));
  const [counter, store] = warehouses;
  const items = PRODUCTS.map(([name, category, costPrice, salePrice, perDay], i) => ({
    id: randomUUID(), schoolId, name, category, costPrice, salePrice, perDay,
    reorderLevel: Math.max(5, Math.round(perDay * 1.5)), barcode: `890100${String(i).padStart(4, '0')}`, unit: 'pcs',
  }));
  const vendors = VENDORS.map(([name, phone, notes]) => ({ id: randomUUID(), schoolId, name, phone, notes }));

  const stock = new Map<string, number>();
  const key = (itemId: string, warehouseId: string) => `${itemId}|${warehouseId}`;
  const qty = (itemId: string, warehouseId: string) => stock.get(key(itemId, warehouseId)) ?? 0;
  const movements: Prisma.PosMovementCreateManyInput[] = [];
  const move = (itemId: string, warehouseId: string, change: number, type: PosMovementType, when: Date, extra: { unitCost?: number; refId?: string; note?: string } = {}) => {
    const next = stockAfter(qty(itemId, warehouseId), change);
    if (next === null) throw new Error('seedPos: stock would go negative');
    stock.set(key(itemId, warehouseId), next);
    movements.push({ schoolId, itemId, warehouseId, type, qty: change, userId: o.cashierId, createdAt: when, ...extra });
  };

  const purchases: Prisma.PosPurchaseCreateManyInput[] = [];
  const purchaseLines: Prisma.PosPurchaseLineCreateManyInput[] = [];
  const sales: Prisma.PosSaleCreateManyInput[] = [];
  const saleLines: Prisma.PosSaleLineCreateManyInput[] = [];

  const restock = (day: string) => {
    const low = items.filter((i) => qty(i.id, store.id) + qty(i.id, counter.id) < i.perDay * 6);
    const byVendor = new Map<number, typeof items>();
    for (const i of low) byVendor.set(vendorFor(i.category), [...(byVendor.get(vendorFor(i.category)) ?? []), i]);
    for (const [v, list] of byVendor) {
      const id = randomUUID();
      const when = at(day, 8, 15);
      const lines = list.map((i) => ({ id: randomUUID(), purchaseId: id, itemId: i.id, qty: Math.max(10, i.perDay * 10), unitCost: i.costPrice }));
      const total = lines.reduce((n, l) => n + l.qty * l.unitCost, 0);
      // Recent bills are still partly unpaid, so the payables report has something to show.
      const recent = days.indexOf(day) > days.length - 8;
      purchases.push({
        id, schoolId, number: documentNumber('PUR', purchases.length, 4), vendorId: vendors[v].id, warehouseId: store.id,
        purchasedOn: new Date(`${day}T00:00:00Z`), total, paid: recent && rng.chance(0.6) ? Math.round(total * 0.4) : total,
        createdById: o.cashierId, createdAt: when,
      });
      for (const l of lines) {
        purchaseLines.push(l);
        move(l.itemId, store.id, l.qty, PosMovementType.PURCHASE, when, { unitCost: l.unitCost, refId: id });
      }
    }
  };

  // Opening stock in the store room, then trade day by day.
  for (const i of items) move(i.id, store.id, i.perDay * 8, PosMovementType.OPENING, at(days[0], 7, 0));
  days.forEach((day, d) => {
    if (d % 7 === 0) restock(day);
    // Top the counter up from the store room each morning.
    for (const i of items) {
      const want = i.perDay * 2 - qty(i.id, counter.id);
      const give = Math.min(want, qty(i.id, store.id));
      if (give > 0) {
        move(i.id, store.id, -give, PosMovementType.TRANSFER_OUT, at(day, 7, 30), { note: 'Store room to Canteen counter' });
        move(i.id, counter.id, give, PosMovementType.TRANSFER_IN, at(day, 7, 30), { note: 'Store room to Canteen counter' });
      }
    }
    const sellings = rng.int(18, 34);
    for (let n = 0; n < sellings; n++) {
      const when = at(day, 10 + rng.int(0, 4), rng.int(0, 59));
      const onAccount = rng.chance(0.15) && o.studentIds.length > 0;
      const id = randomUUID();
      const lines: Prisma.PosSaleLineCreateManyInput[] = [];
      for (const i of rng.shuffle([...items]).slice(0, rng.int(1, 3))) {
        const q = Math.min(rng.int(1, 3), qty(i.id, counter.id));
        if (q < 1) continue;
        lines.push({ id: randomUUID(), saleId: id, itemId: i.id, itemName: i.name, qty: q, unitPrice: i.salePrice, unitCost: i.costPrice });
        move(i.id, counter.id, -q, PosMovementType.SALE, when, { refId: id });
      }
      if (!lines.length) continue;
      const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      // A tab runs for about two weeks before the parent pays it.
      const old = days.indexOf(day) < days.length - 10;
      sales.push({
        id, schoolId, number: documentNumber('S', sales.length), warehouseId: counter.id,
        payment: onAccount ? PosPayment.ON_ACCOUNT : PosPayment.CASH, studentId: onAccount ? rng.pick(o.studentIds) : null,
        subtotal, discount: 0, total: subtotal, settledAt: onAccount && old ? at(days[Math.min(days.length - 1, days.indexOf(day) + 8)], 12, 0) : null,
        cashierId: o.cashierId, createdAt: when,
      });
      saleLines.push(...lines);
    }
  });

  await prisma.posWarehouse.createMany({ data: warehouses });
  await prisma.posItem.createMany({ data: items.map(({ perDay: _perDay, ...i }) => i) });
  await prisma.posVendor.createMany({ data: vendors });
  await prisma.posStock.createMany({ data: [...stock].map(([k, q]) => ({ itemId: k.split('|')[0], warehouseId: k.split('|')[1], qty: q })) });
  await prisma.posMovement.createMany({ data: movements });
  await prisma.posPurchase.createMany({ data: purchases });
  await prisma.posPurchaseLine.createMany({ data: purchaseLines });
  await prisma.posSale.createMany({ data: sales });
  await prisma.posSaleLine.createMany({ data: saleLines });
  return { products: items.length, sales: sales.length, purchases: purchases.length };
}
