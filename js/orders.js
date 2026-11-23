// Order logic (holds, pickups, drop-offs). Pure functions, no DOM. Money in cents, dates 'YYYY-MM-DD'.
import { priceBasket } from './pricing.js';

const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);

/** lines: [{productId, qty, unitPrice, lineType}], groupOf(productId) -> pricing group id. */
export function orderTotals(lines, dealsByGroup, groupOf, deliveryFee = 0) {
  const r = priceBasket(lines.map(l => ({ ...l, group: groupOf(l.productId) })), dealsByGroup);
  return { items: r.total, dealSavings: r.dealSavings, savingsByGroup: r.savingsByGroup, deliveryFee, total: r.total + (deliveryFee || 0) };
}
export const paidTotal = o => sum(o.payments || [], p => p.amount);
export const balance = o => Math.max(0, o.total - paidTotal(o));
export const paymentStatus = o => { const p = paidTotal(o); return p <= 0 ? 'unpaid' : p >= o.total ? 'paid' : 'part'; };
const isHeld = o => o.status === 'held';

/** Units reserved by held orders, optionally only those for one market location. */
export function reservedByProduct(orders, locationId = null) {
  const m = {};
  for (const o of orders) {
    if (!isHeld(o) || (locationId && !(o.fulfilment === 'market' && o.locationId === locationId))) continue;
    for (const l of o.lines) m[l.productId] = (m[l.productId] || 0) + l.qty;
  }
  return m;
}
/** Money received for orders not yet collected (plus cancelled orders still awaiting refund). */
export const liability = orders => sum(orders.filter(o => isHeld(o) || (o.status === 'cancelled' && !o.refunded)), paidTotal);

export function addDays(ymd, n) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** Held and due within the next 7 days (overdue ones included). */
export const dueThisWeek = (o, today) => isHeld(o) && !!o.dueDate && o.dueDate <= addDays(today, 7);
export function filterOrders(orders, f, today) {
  const by = {
    open: isHeld, week: o => dueThisWeek(o, today), unpaid: o => o.status !== 'cancelled' && balance(o) > 0,
    collected: o => o.status === 'collected', all: () => true,
  };
  return orders.filter(by[f] || by.all).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
}
