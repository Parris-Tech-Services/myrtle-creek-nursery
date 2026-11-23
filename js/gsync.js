// Google Sheet sync: confirmed push (the sheet must acknowledge each id) and restore from the sheet.
import { db, getSetting, setSetting, catalog, stamping } from './db.js';
import { STORES, SYNCED_SETTINGS, idOf, pendingOps, batch, applyAcks, backoffMs, mergeRecords, decodeConnection, chipState } from './syncing.js';
import { takeSnapshot, cashRow } from './sync.js';
import { paidTotal, paymentStatus } from './orders.js';
import { peopleText, totalPersonHours } from './staff.js';

const status = { error: null, failures: 0, nextTry: 0, busy: false, pending: 0 };
export const syncStatus = status;
const notify = () => window.dispatchEvent(new Event('syncchange'));
export const getConn = () => getSetting('sheetConn');

async function liveRecords() {
  const live = {};
  for (const name of Object.keys(STORES)) live[name] = await db[name].toArray();
  live.settings = live.settings.filter(r => SYNCED_SETTINGS.includes(r.key));
  return live;
}
const stateMap = async () => Object.fromEntries((await db.syncState.toArray()).map(r => [r.id, r]));
export async function pending() { return pendingOps(await liveRecords(), await stateMap()); }
export async function isAcked(store, rec) { const s = await db.syncState.get(store + ':' + idOf(store, rec)); return !!s && s.acked >= (rec.updatedAt || 0); }
export async function ackedSet() { const m = await stateMap(); return (store, rec) => (m[store + ':' + idOf(store, rec)]?.acked ?? -1) >= (rec.updatedAt || 0); }

// Readable columns for analysis. The full record always goes along in the "json" column.
const money = c => (c || 0) / 100;
const READ = {
  sales: (r, c) => ({ date: c.days[r.marketDayId]?.date || '', time: new Date(r.timestamp).toLocaleTimeString('en-AU'), location: c.loc(c.days[r.marketDayId]?.location),
    items: r.lines.map(l => `${l.qty} x ${c.pn(l.productId, l)}${l.lineType !== 'normal' ? ' (' + l.lineType + ')' : ''}`).join('; '), units: r.lines.reduce((t, l) => t + l.qty, 0),
    dealSavings: money(r.dealSavings), total: money(r.total), payment: r.paymentMethod, cashTendered: money(r.cashTendered), changeGiven: money(r.changeGiven), rounding: money(r.rounding), voided: !!r.voided }),
  marketDays: (r, c) => ({ date: r.date, location: c.loc(r.location), status: r.status, openFloat: money(r.float), counted: r.countedCash == null ? '' : money(r.countedCash), weather: r.weather || '', crowd: r.crowd || '',
    people: peopleText(r), personHours: totalPersonHours(r), keptForNext: r.keepFloat == null ? '' : money(r.keepFloat), banked: r.banked == null ? '' : money(r.banked), notes: r.notes || '' }),
  cashMovements: (r, c) => ({ date: r.date || '', day: c.days[r.marketDayId]?.date || '', type: r.type, category: r.category || '', amount: money(r.amount), note: r.note || '' }),
  orders: (r, c) => ({ customer: r.customer, phone: r.phone || '', fulfilment: r.fulfilment, location: c.loc(r.locationId), dueDate: r.dueDate || '', status: r.status, paymentStatus: paymentStatus(r),
    total: money(r.total), paid: money(paidTotal(r)), collectedDate: r.collectedDate || '', items: r.lines.map(l => `${l.qty} x ${c.pn(l.productId, l)}`).join('; '), notes: r.notes || '' }),
  losses: (r, c) => ({ date: r.date, location: c.loc(r.locationId), product: c.pn(r.productId), qty: r.qty, reason: r.reason, value: money(r.qty * r.unitPrice), note: r.note || '' }),
  soldOut: (r, c) => ({ date: c.days[r.marketDayId]?.date || '', product: c.pn(r.productId), at: new Date(r.ts).toLocaleTimeString('en-AU') }),
  stock: (r, c) => ({ product: c.pn(r.productId), location: c.loc(r.locationId), qty: r.qty }),
  dayStock: (r, c) => ({ date: c.days[r.marketDayId]?.date || '', product: c.pn(r.productId), taken: r.taken, returned: r.returned ?? '' }),
  batches: (r, c) => ({ product: c.pn(r.productId), method: r.method, startDate: r.startDate, qtyStarted: r.qtyStarted, losses: r.losses || 0, moved: r.moved || 0, expectedReady: r.expectedReady || '' }),
  products: r => ({ type: r.type, group: r.group, category: r.category || '', name: r.name, price: r.price == null ? '' : money(r.price), active: !!r.active }),
  types: r => ({ name: r.name }),
  groups: r => ({ name: r.name, unitPrice: money(r.unit), deals: (r.deals || []).map(d => `${d.qty} for ${money(d.price)}`).join(', ') }),
  locations: r => ({ name: r.name }),
  packing: r => ({ qty: r.qty }),
  settings: r => ({ value: JSON.stringify(r.value) }),
};

async function buildItems(ops) {
  const cat = await catalog(), days = Object.fromEntries((await db.marketDays.toArray()).map(d => [d.id, d]));
  const c = { days, loc: id => cat.lmap[id]?.name || id || '', pn: (id, l) => cat.pmap[id]?.label || l?.name || id };
  const items = [];
  for (const op of ops) {
    const base = { key: op.key, store: op.store, id: op.id, updatedAt: op.updatedAt };
    if (op.deleted) { items.push({ ...base, deleted: true }); continue; }
    const rec = await db[op.store].get(op.id);
    if (!rec) continue;
    const row = READ[op.store](rec, c);
    items.push({ ...base, cols: Object.keys(row), row, json: JSON.stringify(rec) });
    if (op.store === 'marketDays') {   // derived, read-only CashCounts sheet
      const cr = await cashRow(rec, cat.lmap); delete cr.id;
      items.push({ key: 'cashCounts:' + op.id, store: 'cashCounts', id: op.id, updatedAt: op.updatedAt, cols: Object.keys(cr), row: cr, json: '' });
    }
  }
  return items;
}

async function call(conn, init, params) {
  const url = init ? conn.url : conn.url + (conn.url.includes('?') ? '&' : '?') + new URLSearchParams({ key: conn.key, ...params });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 90000);   // never let a stuck request block syncing
  let res;
  try { res = await fetch(url, { ...(init ? { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key: conn.key, ...init }) } : {}), signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'The Google Sheet took too long to answer' : 'Could not reach the Google Sheet. If this keeps happening, redeploy the script as a New version (' + e.message + ')'); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'The sheet refused the request');
  return j;
}

/** Push every pending record, 50 per request. A record only counts as synced once its id comes back in `acked`. */
export async function flush({ force = false } = {}) {
  const conn = await getConn();
  if (!conn || !navigator.onLine || status.busy) { await refreshPending(); return { sent: 0 }; }
  if (!force && Date.now() < status.nextTry) return { sent: 0 };
  status.busy = true; let sent = 0;
  try {
    for (const group of batch(await pending(), 50)) {
      const items = await buildItems(group);
      const r = await call(conn, { action: 'push', items });
      const rows = applyAcks(group, r.acked);
      await db.syncState.bulkPut(rows);
      sent += rows.length;
      if (rows.length < group.length) throw new Error(`${group.length - rows.length} record(s) were not acknowledged`);
    }
    status.error = null; status.failures = 0; status.nextTry = 0;
    if (sent) await setSetting('lastSync', Date.now());
  } catch (e) {
    status.error = e.message; status.failures++; status.nextTry = Date.now() + backoffMs(status.failures);
  } finally { status.busy = false; await refreshPending(); }
  return { sent, error: status.error };
}

export async function refreshPending() { status.pending = (await pending()).length; notify(); return status.pending; }
export async function syncChip() {
  const conn = await getConn();
  return { ...chipState({ connected: !!conn, online: navigator.onLine, pending: status.pending, error: status.error }), error: status.error };
}

/** Retry on start, when back online, when the app comes to the front, and every 60 s while anything is waiting. */
export function startSyncLoop() {
  const go = () => flush();
  addEventListener('online', () => { status.nextTry = 0; go(); });
  addEventListener('offline', notify);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
  setInterval(() => { if (status.pending > 0 || status.error) go(); }, 60000);
  go();
}

// ---- connect / disconnect --------------------------------------------------
export async function connect(code) {
  const c = decodeConnection(code);
  if (!c) throw new Error('That does not look like a connection code. Copy it again from the sheet.');
  const j = await call(c, null, { action: 'ping' });
  await setSetting('sheetConn', { url: c.url, key: c.key, name: j.name });
  status.error = null; status.failures = 0; status.nextTry = 0;
  flush({ force: true });
  return j.name;
}
export const disconnect = async () => { await db.settings.delete('sheetConn'); status.error = null; await refreshPending(); };

// ---- restore from the sheet -------------------------------------------------
export async function remoteCounts() { const conn = await getConn(); if (!conn) throw new Error('Connect a sheet first'); return (await call(conn, null, { action: 'counts' })).counts; }
export async function localCounts() { const live = await liveRecords(); return Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.length])); }

export async function restoreFromSheet(mode) {
  const conn = await getConn();
  await takeSnapshot('before restore from sheet');
  const remote = {};
  for (const store of Object.keys(STORES)) {
    remote[store] = [];
    for (let offset = 0; offset !== null && offset !== undefined;) {
      const j = await call(conn, null, { action: 'export', store, offset: String(offset), limit: '200' });
      remote[store].push(...j.records); offset = j.next;
    }
  }
  const written = {};
  stamping.on = false;
  try {
    await db.transaction('rw', db.tables.filter(t => t.name in STORES), db.syncState, async () => {
      for (const [store, recs] of Object.entries(remote)) {
        const local = mode === 'merge' ? await db[store].toArray() : [];
        const { write } = mergeRecords(store, local, recs, mode);
        if (mode === 'replace' && store !== 'settings') await db[store].clear();   // settings hold this device's own state
        await db[store].bulkPut(write);
        await db.syncState.bulkPut(write.map(r => ({ id: store + ':' + idOf(store, r), acked: r.updatedAt || 0 })));
        written[store] = write.length;
      }
      await db.settings.put({ key: 'seeded', value: true });
      await db.settings.put({ key: 'sheetConn', value: conn });   // keep this device connected
    });
  } finally { stamping.on = true; }
  await refreshPending();
  return written;
}
