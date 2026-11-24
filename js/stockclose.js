// Closing a market day: what happens to nursery stock. Database only (no screens), so it can be tested.
// Nursery stock goes down when plants are loaded (taken) and up when they come home (returned). Sold and lost plants simply never come back.
// The one thing left is plants sold or lost BEYOND what was loaded (oversold): those came from somewhere, so they come off nursery stock at close.
import { db, adjustStock, salesForDay, soldByProduct, lossesForDay, lostByProduct, NURSERY } from './db.js';

/** Pure. For each product, how many units were sold or lost beyond what was loaded: sold + lost - taken, when above 0. */
export function closeAdjustments({ taken = {}, sold = {}, lost = {} }) {
  const desired = {};
  for (const id of new Set([...Object.keys(taken), ...Object.keys(sold), ...Object.keys(lost)])) {
    const over = (sold[id] || 0) + (lost[id] || 0) - (taken[id] || 0);
    if (over > 0) desired[id] = over;
  }
  return { desired };
}

const dayTables = () => [db.marketDays, db.dayStock, db.stock, db.sales, db.losses];
const stockOf = async id => (await db.stock.get(id + '|' + NURSERY))?.qty || 0;

/** Gives back what a previous close actually took off nursery stock (stock cannot go below 0, so only the part that was really taken). */
async function giveBack(day) {
  for (const [id, n] of Object.entries(day.oversoldDeducted || {})) await adjustStock(id, n);
}

/** Closes the day and takes oversold units off nursery stock. Safe to call again: it undoes its own earlier deduction first. */
export async function closeDayDb(dayId) {
  return db.transaction('rw', dayTables(), async () => {
    const day = await db.marketDays.get(dayId);
    if (!day) return null;
    await giveBack(day);
    const taken = Object.fromEntries((await db.dayStock.where('marketDayId').equals(dayId).toArray()).map(r => [r.productId, r.taken]));
    const { desired } = closeAdjustments({ taken, sold: soldByProduct(await salesForDay(dayId)), lost: lostByProduct(await lossesForDay(dayId)) });
    const deducted = {};
    for (const [id, over] of Object.entries(desired)) { const before = await stockOf(id); await adjustStock(id, -over); deducted[id] = before - await stockOf(id); }
    Object.assign(day, { status: 'closed', closedAt: day.closedAt && day.status === 'closed' ? day.closedAt : Date.now(), oversoldApplied: desired, oversoldDeducted: deducted });
    await db.marketDays.put(day);
    return day;
  });
}

/** Opens the day again and gives back what close took off nursery stock. */
export async function reopenDayDb(dayId) {
  return db.transaction('rw', dayTables(), async () => {
    const day = await db.marketDays.get(dayId);
    if (!day) return null;
    await giveBack(day);
    Object.assign(day, { status: 'open', closedAt: null, oversoldApplied: {}, oversoldDeducted: {} });
    await db.marketDays.put(day);
    return day;
  });
}

/** "Everything sold": for every product with no coming-home count, set it to what should be left (taken - sold - lost, never below 0). Returns how many were filled. */
export async function useExpectedDb(dayId) {
  return db.transaction('rw', [db.dayStock, db.stock, db.sales, db.losses], async () => {
    const sold = soldByProduct(await salesForDay(dayId)), lost = lostByProduct(await lossesForDay(dayId));
    const rows = Object.fromEntries((await db.dayStock.where('marketDayId').equals(dayId).toArray()).map(r => [r.productId, r]));
    for (const id of [...Object.keys(sold), ...Object.keys(lost)]) rows[id] ||= { id: dayId + '|' + id, marketDayId: dayId, productId: id, taken: 0, returned: null };   // sold without being loaded
    let n = 0;
    for (const r of Object.values(rows)) {
      if (r.returned != null) continue;
      const back = Math.max(0, r.taken - (sold[r.productId] || 0) - (lost[r.productId] || 0));
      await db.dayStock.put({ ...r, returned: back, returnedVerified: true, returnedAssumed: true });
      await adjustStock(r.productId, back);
      n++;
    }
    return n;
  });
}

/** Prefill missing coming-home counts without changing nursery stock. These values are assumptions
 * until the user verifies or edits each count. */
export async function assumeReturnedDb(dayId) {
  return db.transaction('rw', [db.dayStock, db.sales, db.losses], async () => {
    const sold = soldByProduct(await salesForDay(dayId)), lost = lostByProduct(await lossesForDay(dayId));
    const rows = Object.fromEntries((await db.dayStock.where('marketDayId').equals(dayId).toArray()).map(r => [r.productId, r]));
    for (const id of [...Object.keys(sold), ...Object.keys(lost)]) rows[id] ||= { id: dayId + '|' + id, marketDayId: dayId, productId: id, taken: 0, returned: null };
    let n = 0;
    for (const r of Object.values(rows)) {
      if (r.returned != null) continue;
      const back = Math.max(0, r.taken - (sold[r.productId] || 0) - (lost[r.productId] || 0));
      await db.dayStock.put({ ...r, returned: back, returnedVerified: false, returnedAssumed: true });
      n++;
    }
    return n;
  });
}

/** Delete a market day and every record attributable to it. Returns a snapshot so the UI can offer Undo.
 * Stock is reversed without relying on the current record totals: loaded units come back, returns are
 * removed, and any close-time oversold deduction is restored.
 */
export async function deleteMarketDayDb(dayId) {
  return db.transaction('rw',
    [db.marketDays, db.sales, db.orders, db.losses, db.cashMovements, db.soldOut, db.dayStock, db.stock, db.settings],
    async () => {
      const day = await db.marketDays.get(dayId);
      if (!day) return null;
      const snapshot = {
        day,
        sales: await db.sales.where('marketDayId').equals(dayId).toArray(),
        losses: await db.losses.where('marketDayId').equals(dayId).toArray(),
        movements: await db.cashMovements.where('marketDayId').equals(dayId).toArray(),
        soldOut: await db.soldOut.where('marketDayId').equals(dayId).toArray(),
        dayStock: await db.dayStock.where('marketDayId').equals(dayId).toArray(),
        orders: [],
        basket: await db.settings.get('basket')
      };

      const stockRows = snapshot.dayStock;
      for (const r of stockRows) {
        const returned = r.returned || 0;
        if (r.taken - returned !== 0) await adjustStock(r.productId, r.taken - returned);
      }
      for (const [id, n] of Object.entries(day.oversoldDeducted || {})) await adjustStock(id, n);

      for (const sale of snapshot.sales) {
        if (!sale.fromOrder) continue;
        const order = await db.orders.get(sale.fromOrder);
        if (!order || order.collectedDayId !== dayId) continue;
        snapshot.orders.push({ ...order });
        await db.orders.put({
          ...order,
          status: 'held',
          collectedAt: null,
          collectedDate: null,
          collectedDayId: null,
          collectedSaleId: null,
          stockFrom: null
        });
        if (order.stockFrom === 'nursery') {
          for (const line of order.lines || []) await adjustStock(line.productId, line.qty);
        }
      }

      await db.sales.where('marketDayId').equals(dayId).delete();
      await db.losses.where('marketDayId').equals(dayId).delete();
      await db.cashMovements.where('marketDayId').equals(dayId).delete();
      await db.soldOut.where('marketDayId').equals(dayId).delete();
      await db.dayStock.where('marketDayId').equals(dayId).delete();
      await db.marketDays.delete(dayId);
      if (snapshot.basket?.value?.dayId === dayId) await db.settings.delete('basket');
      return snapshot;
    });
}

export async function restoreMarketDayDb(snapshot) {
  if (!snapshot?.day) return false;
  return db.transaction('rw',
    [db.marketDays, db.sales, db.orders, db.losses, db.cashMovements, db.soldOut, db.dayStock, db.stock, db.settings],
    async () => {
      await db.marketDays.put(snapshot.day);
      await db.sales.bulkPut(snapshot.sales);
      await db.losses.bulkPut(snapshot.losses);
      await db.cashMovements.bulkPut(snapshot.movements);
      await db.soldOut.bulkPut(snapshot.soldOut);
      await db.dayStock.bulkPut(snapshot.dayStock);
      await db.orders.bulkPut(snapshot.orders);
      if (snapshot.basket) await db.settings.put(snapshot.basket);

      for (const r of snapshot.dayStock) {
        const returned = r.returned || 0;
        if (r.taken - returned !== 0) await adjustStock(r.productId, -(r.taken - returned));
      }
      for (const [id, n] of Object.entries(snapshot.day.oversoldDeducted || {})) await adjustStock(id, -n);
      for (const order of snapshot.orders) {
        if (order.stockFrom === 'nursery') {
          for (const line of order.lines || []) await adjustStock(line.productId, -line.qty);
        }
      }
      return true;
    });
}
