// Order money and stock changes, database only. Every function re-reads the order inside one transaction,
// so a double tap or a repeat call can never create a second sale or a second payment.
import { db, openDay, adjustStock, NURSERY } from './db.js';
import { uid, ymd } from './util.js';

/** Day a collection is booked against: the open day at that location, else a quiet closed day of its own for that date. */
async function dayForCollection(o) {
  const loc = o.fulfilment === 'pambula' ? 'pambula' : o.fulfilment === 'delivery' ? NURSERY : o.locationId;
  const open = await openDay();
  if (open && open.location === loc) return { day: open, fromStock: 'day', created: false };
  const date = ymd();
  let day = (await db.marketDays.where('location').equals(loc).toArray()).find(d => d.date === date && d.auto);
  const created = !day;
  day ||= { id: uid(), date, location: loc, status: 'closed', float: 0, countedCash: null, notes: 'Order collections', auto: true, closedAt: Date.now() };
  return { day, fromStock: 'nursery', created };
}

/**
 * A payment counts toward the open market day's cash/card/transfer only if the order is for that day's market,
 * or the user says it was taken at the stall. Otherwise it is money received, but not part of that day's float check.
 */
export async function takePaymentDb(orderId, { amount, method, date = ymd(), atStall = false }) {
  return db.transaction('rw', db.orders, db.marketDays, async () => {
    const o = await db.orders.get(orderId), day = await openDay();
    if (!o) return null;
    const here = !!day && ((o.fulfilment === 'market' && o.locationId === day.location) || atStall);
    o.payments = [...(o.payments || []), { id: uid(), amount, method, date, ts: Date.now(), marketDayId: here ? day.id : null }];
    await db.orders.put(o);
    return o;
  });
}

/**
 * Marks an order collected: one sale (items plus any delivery fee, no payments, as the money was counted when paid), and stock
 * taken from the nursery unless the plants came from the day's loaded stock. Returns {ok:true, sale, order} or {ok:false, reason}.
 */
export async function collectDb(orderId) {
  return db.transaction('rw', [db.orders, db.sales, db.marketDays, db.stock], async () => {
    const o = await db.orders.get(orderId);
    if (!o) return { ok: false, reason: 'missing' };
    if (o.status !== 'held') return { ok: false, reason: 'already' };   // a double tap lands here
    const { day, fromStock, created } = await dayForCollection(o);
    const sale = {
      id: uid(), marketDayId: day.id, timestamp: Date.now(), lines: o.lines.map(l => ({ ...l })), dealSavings: o.dealSavings || 0, savingsByGroup: o.savingsByGroup || {},
      deliveryFee: o.deliveryFee || 0, total: o.total, paymentMethod: 'order', payments: [], voided: false, fromOrder: o.id,
    };
    if (created) await db.marketDays.put(day);
    await db.sales.add(sale);
    if (fromStock === 'nursery') for (const l of o.lines) if (l.productId !== 'misc') await adjustStock(l.productId, -l.qty);
    Object.assign(o, { status: 'collected', collectedAt: Date.now(), collectedDate: ymd(), collectedDayId: day.id, collectedSaleId: sale.id, stockFrom: fromStock });
    await db.orders.put(o);
    return { ok: true, sale, order: o };
  });
}

/** Undoes a collection: voids exactly the sale it created and puts the plants back. Does nothing if the order is not collected. */
export async function uncollectDb(orderId) {
  return db.transaction('rw', [db.orders, db.sales, db.stock], async () => {
    const o = await db.orders.get(orderId);
    if (!o || o.status !== 'collected') return false;
    await db.sales.update(o.collectedSaleId, { voided: true, voidedAt: Date.now() });
    if (o.stockFrom === 'nursery') for (const l of o.lines) if (l.productId !== 'misc') await adjustStock(l.productId, l.qty);
    Object.assign(o, { status: 'held', collectedAt: null, collectedDate: null, collectedDayId: null, collectedSaleId: null, stockFrom: null });
    await db.orders.put(o);
    return true;
  });
}
