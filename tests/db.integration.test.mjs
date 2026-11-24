import { resetDb } from './helpers.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const dbm = await import('../js/db.js');
const { db, seedIfEmpty, adjustStock, catalog, packingPlan, nurseryStock, dayReceipts, markets } = dbm;
const { priceBasket } = await import('../js/pricing.js');
const { unitPriceFor, dealsFor } = await import('../js/pricing.js');
const sync = await import('../js/sync.js');
const safety = await import('../js/safety.js');
const { sealBackup, validateBackup, hasMarker } = await import('../js/backup.js');
const flow = await import('../js/orderflow.js');
const close = await import('../js/stockclose.js');
const basket = await import('../js/basketstore.js');

beforeEach(() => resetDb(db));

const DAY = { id: 'd1', date: '2026-12-01', location: 'jamison', status: 'open', float: 5000 };
const sale = (id, productId, qty, extra = {}) => ({ id, marketDayId: 'd1', timestamp: 1, lines: [{ productId, qty, unitPrice: 400, lineType: 'normal' }], total: qty * 400, dealSavings: 0, paymentMethod: 'card', payments: [{ method: 'card', amount: qty * 400 }], voided: false, ...extra });

test('a custom location is available in the catalog and market lists', async () => {
  await seedIfEmpty();
  await db.locations.put({ id: 'custom-market', name: 'Custom Market', hidden: false });
  const cat = await catalog();
  assert.equal(cat.lmap['custom-market'].name, 'Custom Market');
  assert.ok(markets(cat.locations).some(l => l.id === 'custom-market'));
});

test('seed: no sample trees and no nursery stock; 5 mixed punnets cost $20 and 4+5 mixed seedlings and punnets $35', async () => {
  await seedIfEmpty();
  const cat = await catalog();
  assert.equal(cat.products.filter(p => p.type === 'tree').length, 0);
  assert.ok(cat.tmap.tree && cat.gmap.tree);
  assert.equal(await db.stock.count(), 0);
  const pick = (cat1, n) => cat.products.filter(p => p.category === cat1).slice(0, n);
  const lines = [...pick('Basil', 3), ...pick('Kale', 2)].map(p => ({ productId: p.id, qty: 1, unitPrice: unitPriceFor(p, cat.gmap), lineType: 'normal', group: p.group }));
  assert.equal(lines.length, 5);
  assert.equal(priceBasket(lines, dealsFor(cat.gmap)).total, 2000);
  const seeds = cat.products.filter(p => p.group === 'seedling').slice(0, 4).map(p => ({ productId: p.id, qty: 1, unitPrice: unitPriceFor(p, cat.gmap), lineType: 'normal', group: p.group }));
  assert.equal(priceBasket([...seeds, ...lines], dealsFor(cat.gmap)).total, 3500);
});

test('stock never goes negative: it clamps to 0 and records how short it was', async () => {
  await adjustStock('roma', 3);
  await adjustStock('roma', -5);
  const r = await db.stock.get('roma|nursery');
  assert.equal(r.qty, 0); assert.equal(r.shortBy, 2);
  await adjustStock('roma', 4);
  assert.deepEqual([(await db.stock.get('roma|nursery')).qty, (await db.stock.get('roma|nursery')).shortBy], [4, 0]);
});

async function seedData(tag) {
  await db.types.put({ id: 'punnet', name: 'Punnet' + tag });
  await db.products.put({ id: 'p1', name: 'Basil' + tag, type: 'punnet', group: 'punnet', price: null, active: true });
  await db.orders.put({ id: 'o1', customer: 'Sam' + tag, status: 'held', lines: [], payments: [], total: 0 });
  await db.stock.put({ id: 'p1|nursery', productId: 'p1', locationId: 'nursery', qty: 7 });
  await db.settings.put({ key: 'nextFloat', value: { amount: 100, counts: {} } });
  for (const t of ['groups', 'locations', 'marketDays', 'sales', 'dayStock', 'batches', 'cashMovements', 'losses', 'soldOut', 'packing']) void t;
}
const backupBlob = async () => new Blob([await sync.buildBackupText()], { type: 'application/json' });

test('backup: leaves out the Google Sheet key and other device-only settings, and seals the file', async () => {
  await seedData('');
  await db.settings.put({ key: 'sheetConn', value: { url: 'https://x', key: 'SECRET-KEY-123' } });
  await db.settings.put({ key: 'welcomeSeen', value: true });
  const text = await sync.buildBackupText();
  assert.ok(!text.includes('SECRET-KEY-123'));
  const v = await validateBackup(text);
  assert.equal(v.ok, true);
  const keys = JSON.parse(text).tables.settings.map(r => r.key);
  assert.deepEqual(keys, ['nextFloat']);
});

test('restore (replace): safety snapshots survive, the snapshot before the restore exists, and this device keeps its Sheet connection', async () => {
  await seedData('-A');
  const file = await backupBlob();
  await db.orders.put({ id: 'o2', customer: 'Lee', status: 'held', lines: [], payments: [], total: 0 });
  await db.settings.put({ key: 'sheetConn', value: { url: 'https://mine', key: 'MY-KEY-1234' } });
  await safety.saveSnapshot('older snapshot text', 'earlier');
  await sync.importBackup(file, 'restore');
  assert.deepEqual((await db.orders.toArray()).map(o => o.id), ['o1']);   // o2 is gone: replaced
  assert.equal((await db.settings.get('sheetConn')).value.key, 'MY-KEY-1234');
  const snaps = await safety.listSnapshots();
  assert.ok(snaps.some(s => s.reason === 'earlier'), 'earlier snapshot survived');
  const before = snaps.find(s => s.reason === 'before import');
  assert.ok(before, 'a snapshot was taken just before the restore');
  assert.ok((await validateBackup(before.data)).ok);
  assert.ok(before.data.includes('Lee'), 'it holds the data that was replaced');
});

test('a truncated backup is rejected and nothing changes', async () => {
  await seedData('-B');
  const text = await sync.buildBackupText();
  const cut = new Blob([text.slice(0, 20000 > text.length ? Math.floor(text.length / 2) : 20000)]);
  const before = JSON.stringify(await db.orders.toArray()), snapsBefore = (await safety.listSnapshots()).length;
  await assert.rejects(() => sync.importBackup(cut, 'restore'), /not a complete backup/);
  assert.equal(JSON.stringify(await db.orders.toArray()), before);
  assert.equal((await safety.listSnapshots()).length, snapsBefore, 'no snapshot either: nothing was touched');
});

test('a backup with a missing table, a wrong count, edited data or export markers is rejected', async () => {
  await seedData('-C');
  const doc = JSON.parse(await sync.buildBackupText());
  const noOrders = structuredClone(doc); delete noOrders.tables.orders;
  assert.match((await validateBackup(JSON.stringify(noOrders))).error, /missing: orders/);
  const edited = structuredClone(doc); edited.tables.stock[0].qty = 999;
  assert.match((await validateBackup(JSON.stringify(edited))).error, /changed or damaged/);
  const short = structuredClone(doc); short.tables.orders = [];
  assert.match((await validateBackup(JSON.stringify(short))).error, /do not match/);
  assert.match((await validateBackup('{"format":"mcn-backup"')).error, /not a complete backup/);
  assert.match((await validateBackup('{"formatName":"dexie","data":{}}')).error, /not a Myrtle Creek backup/);
  const marked = JSON.parse(await sealBackup({ ...doc.tables, groups: [{ id: 'g', name: 'G', deals: [], $types: { deals: 'arrayNonindexKeys' } }] }));
  assert.match((await validateBackup(JSON.stringify(marked))).error, /damaged \(export markers/);
  assert.equal(hasMarker({ a: [{ b: { $: 1 } }] }), true);
  assert.equal(hasMarker({ price: 5, deals: [{ qty: 4 }] }), false);
});

test('merge: the newer updatedAt wins, an undated row counts as older, new rows are added, nothing else is lost', async () => {
  const T = (id, name, updatedAt) => ({ id, name, ...(updatedAt == null ? {} : { updatedAt }) });
  dbm.stamping.on = false;   // set exact updatedAt values for the test
  try {
    await db.types.bulkPut([T('a', 'file newer', 10), T('b', 'file older', 10), T('c', 'file wins over undated', 10), T('d', 'only in file', 10)]);
    const file = await backupBlob();
    await db.types.clear();
    await db.types.bulkPut([T('a', 'local older', 5), T('b', 'local newer', 20), T('c', 'local undated'), T('e', 'only local', 1)]);
    await db.types.where('id').equals('c').modify(r => { delete r.updatedAt; });
    await sync.importBackup(file, 'merge');
  } finally { dbm.stamping.on = true; }
  const got = Object.fromEntries((await db.types.toArray()).map(t => [t.id, t.name]));
  assert.deepEqual(got, { a: 'file newer', b: 'local newer', c: 'file wins over undated', d: 'only in file', e: 'only local' });
});

test('collecting an order twice (double tap) makes one sale; undo voids that sale', async () => {
  await seedData('');
  await db.marketDays.put({ ...DAY });
  await db.orders.put({ id: 'o9', customer: 'Pat', status: 'held', fulfilment: 'market', locationId: 'jamison', dueDate: '2026-12-01', lines: [{ productId: 'p1', qty: 2, unitPrice: 500, lineType: 'normal' }], items: 1000, total: 1500, deliveryFee: 500, payments: [] });
  const [a, b] = await Promise.all([flow.collectDb('o9'), flow.collectDb('o9')]);
  assert.deepEqual([a.ok, b.ok].sort(), [false, true]);
  const sales = await db.sales.where('marketDayId').equals('d1').toArray();
  assert.equal(sales.length, 1);
  assert.equal(sales[0].total, 1500, 'the delivery fee is in the sale');
  assert.equal((await flow.collectDb('o9')).ok, false);
  assert.equal(await flow.uncollectDb('o9'), true);
  assert.equal((await db.sales.get(sales[0].id)).voided, true);
  assert.equal(await flow.uncollectDb('o9'), false);
  assert.equal((await db.orders.get('o9')).status, 'held');
});

test('collecting away from a market takes the plants off nursery stock once; undo puts them back', async () => {
  await seedData('');
  await db.orders.put({ id: 'o8', customer: 'Kim', status: 'held', fulfilment: 'pambula', lines: [{ productId: 'p1', qty: 3, unitPrice: 500, lineType: 'normal' }], items: 1500, total: 1500, payments: [] });
  await Promise.all([flow.collectDb('o8'), flow.collectDb('o8')]);
  assert.equal((await nurseryStock()).p1, 4);
  await flow.uncollectDb('o8');
  assert.equal((await nurseryStock()).p1, 7);
});

test('order payments count toward the open day only for that market (or when taken at the stall)', async () => {
  await db.marketDays.put({ ...DAY });
  await db.orders.put({ id: 'm1', customer: 'A', status: 'held', fulfilment: 'market', locationId: 'jamison', lines: [], total: 2000, payments: [] });
  await db.orders.put({ id: 'm2', customer: 'B', status: 'held', fulfilment: 'market', locationId: 'wyndham', lines: [], total: 2000, payments: [] });
  await flow.takePaymentDb('m1', { amount: 2000, method: 'cash' });
  await flow.takePaymentDb('m2', { amount: 2000, method: 'cash' });
  await flow.takePaymentDb('m2', { amount: 500, method: 'card', atStall: true });
  const r = await dayReceipts('d1', []);
  assert.deepEqual([r.cash, r.card], [2000, 500]);
});

test('repaid by transfer shows in the day\'s Transfer received', async () => {
  await db.marketDays.put({ ...DAY });
  await db.cashMovements.put({ id: 'r1', marketDayId: 'd1', type: 'repaid', method: 'transfer', amount: 3000, linksTo: 'x' });
  assert.equal((await dayReceipts('d1', [])).transfer, 3000);
});

test('closing a day: oversold units come off nursery stock once, leftovers are returned, reopening reverses it', async () => {
  await db.marketDays.put({ ...DAY });
  await db.stock.put({ id: 'p1|nursery', productId: 'p1', locationId: 'nursery', qty: 20 });
  await adjustStock('p1', -12);                                                               // loaded 12
  await db.dayStock.put({ id: 'd1|p1', marketDayId: 'd1', productId: 'p1', taken: 12, returned: null });
  await db.sales.put(sale('s1', 'p1', 18));                                                    // sold 18: 6 more than loaded
  await db.losses.put({ id: 'l1', marketDayId: 'd1', productId: 'p1', qty: 1, reason: 'dead', unitPrice: 400, date: '2026-12-01', locationId: 'jamison' });
  assert.equal(await close.useExpectedDb('d1'), 1);                                            // expected leftovers: max(0, 12-18-1) = 0
  assert.equal((await db.dayStock.get('d1|p1')).returned, 0);
  await close.closeDayDb('d1'); await close.closeDayDb('d1');                                  // twice: still applied once
  assert.equal((await nurseryStock()).p1, 8 - 7);                                              // 20-12=8, minus 7 oversold (18+1-12)
  assert.equal((await db.marketDays.get('d1')).status, 'closed');
  await close.reopenDayDb('d1');
  assert.equal((await nurseryStock()).p1, 8);
  assert.equal((await db.marketDays.get('d1')).status, 'open');
});

test('deleting a market day reverses loaded and returned stock and can be undone', async () => {
  await db.marketDays.put({ ...DAY });
  await db.stock.put({ id: 'p1|nursery', productId: 'p1', locationId: 'nursery', qty: 20 });
  await db.dayStock.put({ id: 'd1|p1', marketDayId: 'd1', productId: 'p1', taken: 10, returned: 4 });
  await adjustStock('p1', -10);
  await adjustStock('p1', 4);
  await db.sales.put(sale('s1', 'p1', 3));
  await db.losses.put({ id: 'l1', marketDayId: 'd1', productId: 'p1', qty: 1, reason: 'dead', unitPrice: 400, date: DAY.date, locationId: 'jamison' });

  const snapshot = await close.deleteMarketDayDb('d1');
  assert.ok(snapshot);
  assert.equal(await db.marketDays.get('d1'), undefined);
  assert.equal(await db.sales.count(), 0);
  assert.equal(await db.losses.count(), 0);
  assert.equal((await db.stock.get('p1|nursery')).qty, 20);

  assert.equal(await close.restoreMarketDayDb(snapshot), true);
  assert.ok(await db.marketDays.get('d1'));
  assert.equal(await db.sales.count(), 1);
  assert.equal(await db.losses.count(), 1);
  assert.equal((await db.stock.get('p1|nursery')).qty, 14);
});

test('"use expected" also covers products that were sold but never loaded, so every product ends up with a count', async () => {
  await db.marketDays.put({ ...DAY });
  await db.sales.put(sale('s1', 'p9', 3));
  assert.equal(await close.useExpectedDb('d1'), 1);
  const r = await db.dayStock.get('d1|p9');
  assert.deepEqual([r.taken, r.returned], [0, 0]);
  assert.equal(await close.useExpectedDb('d1'), 0);
});

test('coming-home assumptions do not change stock until verified', async () => {
  await db.marketDays.put({ ...DAY });
  await db.dayStock.put({ id: 'd1|p1', marketDayId: 'd1', productId: 'p1', taken: 10, returned: null });
  await db.sales.put(sale('s1', 'p1', 3));
  await db.stock.put({ id: 'p1|nursery', productId: 'p1', locationId: 'nursery', qty: 20 });
  assert.equal(await close.assumeReturnedDb('d1'), 1);
  let r = await db.dayStock.get('d1|p1');
  assert.deepEqual([r.returned, r.returnedVerified, r.returnedAssumed], [7, false, true]);
  assert.equal((await db.stock.get('p1|nursery')).qty, 20);
});

test('closing a day with leftovers: returned units go back and nothing extra is deducted', async () => {
  await db.marketDays.put({ ...DAY });
  await db.stock.put({ id: 'p1|nursery', productId: 'p1', locationId: 'nursery', qty: 10 });
  await adjustStock('p1', -10);
  await db.dayStock.put({ id: 'd1|p1', marketDayId: 'd1', productId: 'p1', taken: 10, returned: null });
  await db.sales.put(sale('s1', 'p1', 6));
  await close.useExpectedDb('d1');                                                            // 4 come home
  await close.closeDayDb('d1');
  assert.equal((await nurseryStock()).p1, 4);
});

test('the basket is saved per market day and survives; it is gone once emptied', async () => {
  const lines = [{ key: 'k1', productId: 'p1', qty: 2, unitPrice: 500, lineType: 'normal', note: '' }];
  await basket.saveBasket('d1', lines);
  assert.deepEqual(await basket.loadBasket('d1'), lines);
  assert.deepEqual(await basket.loadBasket('d2'), []);
  await basket.saveBasket('d1', []);
  assert.deepEqual(await basket.loadBasket('d1'), []);
  assert.equal(await db.settings.get('basket'), undefined);
});

test('packing: a quantity typed today applies to today only; a new market falls back to the all-market average', async () => {
  await seedIfEmpty();
  await db.stock.bulkPut([{ id: 'basil-purple|nursery', productId: 'basil-purple', locationId: 'nursery', qty: 4 }]);
  // history exists only at Jamison
  await db.marketDays.put({ id: 'h1', date: '2026-11-01', location: 'jamison', status: 'closed' });
  await db.dayStock.put({ id: 'h1|basil-purple', marketDayId: 'h1', productId: 'basil-purple', taken: 12, returned: 0 });
  await db.sales.put({ ...sale('hs', 'basil-purple', 10), marketDayId: 'h1' });
  const forNew = (await packingPlan('wyndham', '2026-12-01')).find(r => r.product.id === 'basil-purple');
  assert.match(forNew.reason, /new here: average across markets/);
  assert.equal(forNew.demand, 12); assert.equal(forNew.shortfall, 8); assert.equal(forNew.qty, 4);
  await db.packing.put({ id: 'wyndham|basil-purple', qty: 3, date: '2026-11-30' });
  assert.equal((await packingPlan('wyndham', '2026-12-01')).find(r => r.product.id === 'basil-purple').edited, undefined);
  assert.equal((await packingPlan('wyndham', '2026-11-30')).find(r => r.product.id === 'basil-purple').qty, 3);
});

test('packing: a product that sold 0 at the last visit is not dropped if it sold before', async () => {
  await seedIfEmpty();
  await db.stock.put({ id: 'basil-purple|nursery', productId: 'basil-purple', locationId: 'nursery', qty: 30 });
  for (const [i, n] of [[1, 8], [2, 0]]) {
    await db.marketDays.put({ id: 'h' + i, date: `2026-11-0${i}`, location: 'jamison', status: 'closed' });
    await db.dayStock.put({ id: `h${i}|basil-purple`, marketDayId: 'h' + i, productId: 'basil-purple', taken: 10, returned: 10 - n });
    if (n) await db.sales.put({ ...sale('s' + i, 'basil-purple', n), marketDayId: 'h' + i });
  }
  const row = (await packingPlan('jamison', '2026-12-01')).find(r => r.product.id === 'basil-purple');
  assert.ok(row.qty >= 2, `suggested ${row.qty}`);
});

test('closing a day: only units sold or lost beyond what was loaded count as oversold', () => {
  assert.deepEqual(close.closeAdjustments({ taken: { a: 12, b: 5 }, sold: { a: 18, b: 3 }, lost: { a: 1 } }), { desired: { a: 7 } });
  assert.deepEqual(close.closeAdjustments({ taken: { a: 12 }, sold: { a: 10 } }), { desired: {} });
});

test('closing when nursery stock is too low: stock stops at 0, is flagged, and reopening gives back only what was really taken', async () => {
  await db.marketDays.put({ ...DAY });
  await db.stock.put({ id: 'p1|nursery', productId: 'p1', locationId: 'nursery', qty: 2 });
  await db.dayStock.put({ id: 'd1|p1', marketDayId: 'd1', productId: 'p1', taken: 0, returned: 0 });
  await db.sales.put(sale('s1', 'p1', 5));                          // 5 sold, none loaded, only 2 in the nursery
  await close.closeDayDb('d1');
  assert.deepEqual([(await db.stock.get('p1|nursery')).qty, (await db.stock.get('p1|nursery')).shortBy], [0, 3]);
  await close.closeDayDb('d1');                                       // again: no double deduction
  assert.equal((await db.stock.get('p1|nursery')).qty, 0);
  await close.reopenDayDb('d1');
  assert.equal((await db.stock.get('p1|nursery')).qty, 2, 'back to what it was, not inflated');
});

// ---- round trips: the real export, import, snapshot and Sheet-restore code on a database full of arrays and nested objects ----
async function richData() {
  await seedIfEmpty();
  await db.marketDays.put({ id: 'd1', date: '2026-12-01', location: 'jamison', status: 'closed', float: 5000, countedCash: 12000, floatCounts: { 2000: 2, 100: 10 }, closeCounts: { 5000: 1, 2000: 3 },
    staff: [{ name: 'Luca', arrive: '07:00', leave: '16:00' }, { name: 'Ysis', arrive: '', leave: '' }], keepFloat: 10000, weather: 'sunny', crowd: 4, oversoldApplied: { p1: 2 }, oversoldDeducted: { p1: 1 } });
  await db.sales.put({ id: 's1', marketDayId: 'd1', timestamp: 1, lines: [{ productId: 'p1', qty: 4, unitPrice: 400, lineType: 'normal', note: '' }, { productId: 'misc', name: 'Pot', qty: 1, unitPrice: 300, lineType: 'other', note: 'x' }],
    total: 1500, dealSavings: 100, savingsByGroup: { seedling: 100 }, paymentMethod: 'split', payments: [{ method: 'cash', amount: 1000 }, { method: 'card', amount: 500 }], voided: false, cashTendered: 2000, changeGiven: 1000, rounding: 0 });
  await db.orders.put({ id: 'o1', customer: 'Sam', status: 'held', fulfilment: 'delivery', address: '1 Road', lines: [{ productId: 'p1', qty: 2, unitPrice: 500, lineType: 'normal' }], items: 1000, total: 1500, deliveryFee: 500,
    payments: [{ id: 'pay1', amount: 500, method: 'card', date: '2026-12-01', ts: 5, marketDayId: null }] });
  await db.cashMovements.put({ id: 'c1', marketDayId: 'd1', type: 'cashOut', category: 'fuel', amount: 3000, method: 'cash', counts: { 2000: 1, 1000: 1 }, note: 'Diesel' });
  await db.settings.put({ key: 'staffNames', value: [{ name: 'Luca' }, { name: 'Ysis', hidden: true }] });
  await db.settings.put({ key: 'nextFloat', value: { amount: 10000, counts: { 2000: 2, 1000: 4 } } });
  await db.settings.put({ key: 'sheetConn', value: { url: 'https://x', key: 'KEY-1234567' } });
  await db.packing.put({ id: 'jamison|p1', qty: 5, date: '2026-12-01' });
}
const tablesNow = async () => { const t = {}; for (const n of Object.keys((await import('../js/syncing.js')).STORES)) t[n] = (await db[n].toArray()).filter(r => n !== 'settings' || r.key === 'staffNames' || r.key === 'nextFloat').sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key))); return t; };
const asBlob = text => new Blob([text], { type: 'application/json' });

test('round trip: export, restore, export, restore again: identical every time, no markers anywhere', async () => {
  await richData();
  const original = await tablesNow();
  const a = await sync.buildBackupText();
  assert.ok(!a.includes('$types'));
  await sync.importBackup(asBlob(a), 'restore');
  assert.deepEqual(await tablesNow(), original);
  const b = await sync.buildBackupText();
  assert.deepEqual(JSON.parse(b).tables, JSON.parse(a).tables);
  await sync.importBackup(asBlob(b), 'restore');
  assert.deepEqual(await tablesNow(), original);
  for (const t of Object.values(await tablesNow())) assert.equal(hasMarker(t), false);
  assert.equal((await db.settings.get('sheetConn')).value.key, 'KEY-1234567');
});

test('round trip through snapshots: takeSnapshot then restoreSnapshot, twice, with changes in between', async () => {
  await richData();
  const original = await tablesNow();
  await sync.takeSnapshot('first');
  const first = (await safety.listSnapshots()).find(s => s.reason === 'first');
  await db.orders.clear(); await db.groups.clear();
  await sync.restoreSnapshot(first.id);
  assert.deepEqual(await tablesNow(), original);
  await sync.takeSnapshot('second');                       // a snapshot taken AFTER a restore must also restore
  const second = (await safety.listSnapshots()).find(s => s.reason === 'second');
  await db.sales.clear();
  await sync.restoreSnapshot(second.id);
  assert.deepEqual(await tablesNow(), original);
});

test('round trip: merge, then export and restore the merged data', async () => {
  await richData();
  const fileText = await sync.buildBackupText();
  await db.orders.update('o1', { customer: 'Changed locally' });        // newer locally than the file
  await db.types.put({ id: 'extra', name: 'Only local' });
  await sync.importBackup(asBlob(fileText), 'merge');
  assert.equal((await db.orders.get('o1')).customer, 'Changed locally');
  assert.ok(await db.types.get('extra'));
  const merged = await tablesNow();
  const again = await sync.buildBackupText();
  await sync.importBackup(asBlob(again), 'restore');
  assert.deepEqual(await tablesNow(), merged);
  assert.equal(hasMarker(merged), false);
});

test('restore from the Google Sheet goes through the same validated path and the result exports and restores cleanly', async () => {
  await richData();
  const gsync = await import('../js/gsync.js');
  const remote = await tablesNow();                                      // what the sheet's _data tab would hold, as parsed json records
  await db.settings.put({ key: 'sheetConn', value: { url: 'https://script.google.com/macros/s/X/exec', key: 'KEY-1234567', name: 'Sheet' } });
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = new URL(url), store = u.searchParams.get('store'), off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
    const rows = remote[store] || [];
    return new Response(JSON.stringify({ ok: true, records: rows.slice(off, off + lim), next: off + lim < rows.length ? off + lim : null, scriptVersion: 1 }));
  };
  try {
    await db.orders.clear(); await db.groups.clear(); await db.sales.clear();
    const counts = await gsync.restoreFromSheet('replace');
    assert.equal(counts.orders, 1);
  } finally { globalThis.fetch = real; }
  assert.deepEqual(await tablesNow(), remote);
  const text = await sync.buildBackupText();
  await db.orders.clear();
  await sync.importBackup(asBlob(text), 'restore');
  assert.deepEqual(await tablesNow(), remote);
  assert.ok((await safety.listSnapshots()).some(s => s.reason === 'before import'));
  assert.equal((await db.settings.get('sheetConn')).value.key, 'KEY-1234567', 'this device keeps its connection');
});

test('one-time repair strips stray export markers from live rows', async () => {
  await db.groups.put({ id: 'g1', name: 'G', unit: 400, deals: [{ qty: 4, price: 1500 }], $types: { deals: 'arrayNonindexKeys' } });
  assert.equal(await dbm.repairStrayMarkers(), 1);
  const g = await db.groups.get('g1');
  assert.equal('$types' in g, false);
  assert.deepEqual(g.deals, [{ qty: 4, price: 1500 }]);
  assert.equal(await dbm.repairStrayMarkers(), 0, 'runs once');
});

// ---- protected snapshots, and refusing to replace from a blank or smaller Sheet ----
const snap = (id, ts, protect) => ({ id, ts, ...(protect ? { protect } : {}) });

test('snapshot rotation keeps the last-restore one, the first of each of the last 3 days, and the newest 5', () => {
  const at = (d, h) => new Date(2026, 11, 10 - d, 8 + h).getTime();   // local times, so "first of the day" means the same everywhere
  const list = [snap('restoreOld', at(20, 0), 'restore')];
  for (let d = 5; d >= 0; d--) for (let h = 0; h < 4; h++) list.push(snap(`d${d}h${h}`, at(d, h)));   // 4 snapshots a day for 6 days
  const keep = safety.snapshotsToKeep(list);
  assert.ok(keep.has('restoreOld'), 'the protected pre-restore snapshot survives however old');
  for (const d of [0, 1, 2]) assert.ok(keep.has(`d${d}h0`), `first snapshot of day ${d} is protected`);
  assert.ok(!keep.has('d5h0') && !keep.has('d4h1'), 'old unprotected ones are dropped');
  assert.equal([...keep].filter(id => !['restoreOld', 'd0h0', 'd1h0', 'd2h0'].includes(id)).length, 5);
  const labels = safety.snapshotLabels(list);
  assert.match(labels.restoreOld, /Before last restore/); assert.match(labels.d0h0, /First of the day/);
});

test('several restores in a row never push out the snapshot taken before the last restore; the next restore replaces it', async () => {
  await seedData('-S');
  const file = new Blob([await sync.buildBackupText()]);
  await db.orders.put({ id: 'precious', customer: 'Before the restore', status: 'held', lines: [], payments: [], total: 0 });
  await sync.importBackup(file, 'restore');
  const first = (await safety.listSnapshots()).find(s => s.protect === 'restore');
  assert.ok(first.data.includes('Before the restore'));
  for (let i = 0; i < 8; i++) await sync.takeSnapshot('filler ' + i);          // lots of other snapshots
  assert.ok((await safety.listSnapshots()).some(s => s.id === first.id), 'still there after 8 more snapshots');
  assert.equal((await safety.listSnapshots()).filter(s => s.protect === 'restore').length, 1);
  await db.orders.put({ id: 'second', customer: 'Before the second restore', status: 'held', lines: [], payments: [], total: 0 });
  await sync.importBackup(file, 'restore');
  const protectedNow = (await safety.listSnapshots()).filter(s => s.protect === 'restore');
  assert.equal(protectedNow.length, 1);
  assert.ok(protectedNow[0].data.includes('Before the second restore'), 'replaced by the newest pre-restore snapshot');
});

async function sheetWith(remote) {
  const gsync = await import('../js/gsync.js');
  await db.settings.put({ key: 'sheetConn', value: { url: 'https://script.google.com/macros/s/X/exec', key: 'KEY-1234567', name: 'Sheet' } });
  const real = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = new URL(url), store = u.searchParams.get('store'), off = Number(u.searchParams.get('offset')), lim = Number(u.searchParams.get('limit'));
    const rows = remote[store] || [];
    return new Response(JSON.stringify({ ok: true, records: rows.slice(off, off + lim), next: off + lim < rows.length ? off + lim : null, scriptVersion: 1 }));
  };
  return { gsync, done: () => { globalThis.fetch = real; } };
}

test('Replace from a blank Sheet is refused and the device is untouched; Merge from it is allowed', async () => {
  await richData();
  const before = JSON.stringify(await tablesNow());
  const { gsync, done } = await sheetWith({});
  try {
    await assert.rejects(() => gsync.restoreFromSheet('replace', { confirmedLoss: true }), /blank or wrong/);   // even "confirmed" cannot wipe from a blank Sheet
    assert.equal(JSON.stringify(await tablesNow()), before);
    await gsync.restoreFromSheet('merge');
    assert.equal(JSON.stringify(await tablesNow()), before, 'merge adds nothing and removes nothing');
  } finally { done(); }
});

test('Replace from a much smaller Sheet needs confirmation, then goes ahead', async () => {
  await richData();
  const full = await tablesNow();
  const small = { ...full, sales: [], orders: [], products: full.products.slice(0, 2), groups: full.groups, types: full.types, locations: full.locations };
  small.sales = [{ ...full.sales[0] }];
  await db.sales.put({ id: 's2', marketDayId: 'd1', timestamp: 2, lines: [], total: 0, paymentMethod: 'card', payments: [], voided: false });   // the device has 2 sales, the Sheet 1
  const { gsync, done } = await sheetWith(small);
  try {
    await assert.rejects(() => gsync.restoreFromSheet('replace'), /fewer records than this device.*Type REPLACE/);
    assert.ok(await db.sales.get('s2'), 'nothing changed');
    await gsync.restoreFromSheet('replace', { confirmedLoss: true });
    assert.equal(await db.sales.get('s2'), undefined);
    assert.equal((await db.products.toArray()).length, 2);
  } finally { done(); }
});
