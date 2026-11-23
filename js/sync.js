import { db, setSetting, catalog, salesForDay, dayCash, stamping } from './db.js';
import { DENOMS, denomLabel } from './cash.js';
import { ymd, lineNets, uid } from './util.js';
import { paidTotal, paymentStatus } from './orders.js';
import { peopleText, totalPersonHours, netPerHour } from './staff.js';
const { exportDB, importInto } = window.DexieExportImport;

/** One row per market day: float and close counts by denomination, expected vs counted, kept and banked. */
export async function cashRow(d, lmap) {
  const { expected } = await dayCash(d, await salesForDay(d.id));
  const row = {
    id: d.id, date: d.date, location: lmap[d.location]?.name || '', openFloat: (d.float || 0) / 100, expected: expected / 100,
    counted: d.countedCash == null ? '' : d.countedCash / 100, overShort: d.countedCash == null ? '' : (d.countedCash - expected) / 100,
    keptForNext: d.keepFloat == null ? '' : d.keepFloat / 100, banked: d.keepFloat == null || d.countedCash == null ? '' : (d.countedCash - d.keepFloat) / 100,
  };
  for (const c of DENOMS) { row['open_' + denomLabel(c)] = d.floatCounts?.[c] || 0; row['close_' + denomLabel(c)] = d.closeCounts?.[c] || 0; }
  return row;
}
/** One row per market day: weather, crowd, notes, who was there, person-hours, sales, expenses, net. */
export async function daysCsv() {
  const { lmap } = await catalog();
  const rows = [];
  for (const d of (await db.marketDays.toArray()).sort((a, b) => a.date.localeCompare(b.date))) {
    const sales = await salesForDay(d.id), total = sales.reduce((t, s) => t + s.total, 0), { expenses } = await dayCash(d, sales), net = total - expenses;
    rows.push({ id: d.id, date: d.date, location: lmap[d.location]?.name || '', status: d.status, weather: d.weather || '', crowd: d.crowd || '', notes: d.notes || '',
      setup: d.setupTime || '', packup: d.packupTime || '', people: peopleText(d), personHours: totalPersonHours(d), sales: (total / 100).toFixed(2), expenses: (expenses / 100).toFixed(2), net: (net / 100).toFixed(2),
      netPerPersonHour: netPerHour(net, d) == null ? '' : (netPerHour(net, d) / 100).toFixed(2) });
  }
  return window.Papa.unparse(rows.length ? rows : [{ id: '' }]);
}
export async function cashCsv() {
  const { lmap } = await catalog();
  const rows = []; for (const d of (await db.marketDays.toArray()).sort((a, b) => a.date.localeCompare(b.date))) rows.push(await cashRow(d, lmap));
  return window.Papa.unparse(rows.length ? rows : [{ id: '' }]);
}

// ---- backup / restore ----------------------------------------------------
const BACKUP_SKIP = new Set(['snapshots', 'syncState']);
/** Hand a file to the iOS share sheet if possible, otherwise download it. Returns true if delivered. */
export async function deliverFile(blob, name) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

export async function exportBackup() {
  const blob = await exportDB(db, { filter: t => !BACKUP_SKIP.has(t) });
  const ok = await deliverFile(blob, `myrtle-creek-backup-${ymd()}.json`);
  if (ok) await setSetting('lastBackup', Date.now());
  return ok;
}

/** mode 'restore' replaces everything; 'merge' adds/overwrites rows by id and keeps everything else. */
export async function importBackup(file, mode) {
  await takeSnapshot('before import');
  const keep = mode === 'merge' ? t => !BACKUP_SKIP.has(t) && t !== 'settings' : t => !BACKUP_SKIP.has(t);
  stamping.on = false;   // keep the file's own updatedAt values
  try { await importInto(db, file, { clearTablesBeforeImport: mode === 'restore', overwriteValues: true, acceptNameDiff: true, acceptVersionDiff: true, filter: keep }); }
  finally { stamping.on = true; }
  await setSetting('seeded', true);   // never re-seed the example products over restored data
  await db.syncState.clear();         // everything is re-sent; the sheet keeps whichever copy is newer
}

// ---- rolling local snapshots (last 5), a guard against bad imports --------
export async function takeSnapshot(reason = 'auto') {
  const data = await (await exportDB(db, { filter: t => !BACKUP_SKIP.has(t) })).text();
  await db.snapshots.put({ id: uid(), ts: Date.now(), reason, data });
  const all = await db.snapshots.toArray();
  all.sort((a, b) => b.ts - a.ts);
  await db.snapshots.bulkDelete(all.slice(5).map(x => x.id));
}
export async function snapshotIfStale(hours = 6) {
  const all = await db.snapshots.toArray();
  if (!all.length || Date.now() - Math.max(...all.map(x => x.ts)) > hours * 3600e3) await takeSnapshot('auto');
}
export const restoreSnapshot = async id => importBackup(new Blob([(await db.snapshots.get(id)).data], { type: 'application/json' }), 'restore');

export async function ordersCsv() {
  const { pmap, lmap } = await catalog();
  const rows = (await db.orders.toArray()).map(o => ({
    id: o.id, customer: o.customer, phone: o.phone || '', fulfilment: o.fulfilment, location: lmap[o.locationId]?.name || '', address: o.address || '', dueDate: o.dueDate || '',
    status: o.status, paymentStatus: paymentStatus(o), total: (o.total / 100).toFixed(2), paid: (paidTotal(o) / 100).toFixed(2), deliveryFee: ((o.deliveryFee || 0) / 100).toFixed(2),
    collectedDate: o.collectedDate || '', items: o.lines.map(l => `${l.qty} x ${pmap[l.productId]?.label || l.name || l.productId}`).join('; '), notes: o.notes || '',
  }));
  return window.Papa.unparse(rows.length ? rows : [{ id: '' }]);
}

export async function salesCsv(from = '', to = '') {
  const { pmap, tmap, gmap, lmap } = await catalog();
  const days = Object.fromEntries((await db.marketDays.toArray()).map(d => [d.id, d]));
  const rows = [];
  for (const s of (await db.sales.orderBy('timestamp').toArray()).filter(s => !s.voided)) {
    const d = days[s.marketDayId]; if (!d || (from && d.date < from) || (to && d.date > to)) continue;
    const nets = lineNets(s, pmap);
    s.lines.forEach((l, i) => rows.push({
      saleId: s.id, date: d.date, time: new Date(s.timestamp).toLocaleTimeString('en-AU'), location: lmap[d.location]?.name || '',
      payment: s.paymentMethod, type: tmap[pmap[l.productId]?.type]?.name || '', group: gmap[pmap[l.productId]?.group]?.name || '', category: pmap[l.productId]?.category || '', variety: pmap[l.productId]?.name || l.name || l.productId,
      qty: l.qty, unitPrice: (l.unitPrice / 100).toFixed(2), lineType: l.lineType, note: l.note || '',
      lineGross: (l.qty * l.unitPrice / 100).toFixed(2), lineNetOfDeals: (nets[i] / 100).toFixed(2), saleTotal: (s.total / 100).toFixed(2),
    }));
  }
  return window.Papa.unparse(rows.length ? rows : [{ saleId: '' }]);
}
