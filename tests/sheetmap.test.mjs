import test from 'node:test';
import assert from 'node:assert/strict';
import { TABS, TABS_OF_STORE, rowsFor, tabDefs, hhmm } from '../js/sheetmap.js';

const day = { id: 'd1', date: '2026-12-01', location: 'jamison', status: 'closed', float: 5000, countedCash: 12000, setupTime: '06:30', packupTime: '14:00', staff: [{ name: 'Luca Dorrough' }], crowd: 4, weather: 'sunny' };
const ctx = { days: { d1: day }, loc: id => ({ jamison: 'Jamison Markets' })[id] || id || '', pn: (id, l) => ({ roma: 'Tomato - Roma' })[id] || l?.name || id,
  pmap: { roma: { type: 'tube', category: 'Tomato' } },
  gmap: { seedling: { name: 'Seedling' } }, tmap: { tube: { name: 'Tube' } }, cash: { expected: 11900 } };
const TYPES = new Set(['text', 'date', 'time', 'money', 'num', 'dec']);

test('every tab has plain English headers and known column types', () => {
  for (const [tab, cols] of Object.entries(TABS)) {
    assert.ok(cols.length > 1, tab);
    for (const c of cols) { assert.ok(TYPES.has(c.t), `${tab}/${c.h}`); assert.ok(!/json|updatedAt|^id$/i.test(c.h), `${tab}/${c.h}`); }
  }
  assert.deepEqual(Object.keys(TABS).slice(0, 3), ['Sales', 'Market days', 'Cash counts']);
});

const SAMPLES = {
  sales: { id: 's1', marketDayId: 'd1', timestamp: new Date(2026, 11, 1, 9, 5).getTime(), lines: [{ productId: 'roma', qty: 4, unitPrice: 400, lineType: 'normal' }, { productId: 'misc', name: 'Pot', qty: 1, unitPrice: 300, lineType: 'other' }], total: 1800, dealSavings: 100, paymentMethod: 'cash', cashTendered: 2000, changeGiven: 200, rounding: 0, voided: false },
  marketDays: day,
  cashMovements: { id: 'c1', marketDayId: 'd1', type: 'cashOut', category: 'fuel', amount: 3000, method: 'cash', date: '2026-12-01', note: 'Diesel' },
  orders: { id: 'o1', customer: 'Sam', fulfilment: 'market', locationId: 'jamison', dueDate: '2026-12-08', status: 'held', lines: [{ productId: 'roma', qty: 2, unitPrice: 400 }], total: 800, payments: [{ amount: 800, method: 'card' }] },
  losses: { id: 'l1', date: '2026-12-01', locationId: 'jamison', productId: 'roma', qty: 2, reason: 'heat', unitPrice: 400 },
  dayStock: { id: 'd1|roma', marketDayId: 'd1', productId: 'roma', taken: 10, returned: 2 },
  soldOut: { id: 'so1', marketDayId: 'd1', productId: 'roma', ts: new Date(2026, 11, 1, 10, 30).getTime() },
  stock: { id: 'roma|nursery', productId: 'roma', locationId: 'jamison', qty: 7 },
  batches: { id: 'b1', productId: 'roma', method: 'sown', startDate: '2026-10-01', qtyStarted: 50, losses: 2, moved: 30, expectedReady: '2026-12-01' },
  products: { id: 'roma', name: 'Roma', category: 'Tomato', type: 'tube', group: 'seedling', price: null, active: true },
  groups: { id: 'seedling', name: 'Seedling', unit: 400, deals: [{ qty: 4, price: 1500 }] },
};

test('each row lines up with its tab columns, with real types', () => {
  for (const [store, rec] of Object.entries(SAMPLES)) {
    const { rows } = rowsFor(store, rec, ctx);
    assert.ok(rows.length >= 1, store);
    for (const r of rows) {
      assert.equal(r.cells.length, TABS[r.tab].length, `${store} -> ${r.tab}`);
      assert.equal(r.id.startsWith(store + ':'), true);
      r.cells.forEach((v, i) => {
        const t = TABS[r.tab][i].t;
        if (v === '') return;
        if (t === 'money' || t === 'num' || t === 'dec') assert.equal(typeof v, 'number', `${r.tab}/${TABS[r.tab][i].h}`);
        if (t === 'date') assert.match(v, /^\d{4}-\d{2}-\d{2}$/, `${r.tab}/${TABS[r.tab][i].h}`);
        if (t === 'time') assert.match(v, /^\d{2}:\d{2}$/, `${r.tab}/${TABS[r.tab][i].h}`);
      });
    }
  }
});

test('sales row: friendly values, money in dollars, voided as Yes or blank', () => {
  const [row] = rowsFor('sales', SAMPLES.sales, ctx).rows;
  assert.deepEqual(row.cells.slice(0, 8), ['2026-12-01', '09:05', 'Jamison Markets', '4 x Tomato - Roma; 1 x Pot (other)', 5, 18, 1, 'Cash']);
  assert.deepEqual(row.cells.slice(8), [20, 2, 0, '']);
  assert.equal(rowsFor('sales', { ...SAMPLES.sales, voided: true }, ctx).rows[0].cells[11], 'Yes');
});

test('sales also writes one normalized row per sale line', () => {
  const result = rowsFor('sales', SAMPLES.sales, ctx);
  assert.deepEqual(result.rows.map(r => r.tab), ['Sales', 'Sale lines', 'Sale lines']);
  assert.deepEqual(result.rows[1].cells.slice(4, 11), ['Tomato - Roma', 'Tube', 'Tomato', 4, 4, 'normal', 16]);
  assert.equal(result.rows[2].cells[4], 'Pot');
  assert.equal(result.rows[2].cells[9], 'other');
});

test('market day also feeds Cash counts (expected vs counted, denominations)', () => {
  const { rows } = rowsFor('marketDays', day, ctx);
  assert.deepEqual(rows.map(r => r.tab), ['Market days', 'Cash counts']);
  assert.deepEqual(rows[1].cells.slice(2, 8), [50, 119, 120, 1, '', '']);
  assert.equal(rows[0].cells[7], 'Luca Dorrough'); assert.equal(rows[0].cells[8], 7.5);
});

test('tabs only for the readable stores; people replace the whole tab', () => {
  for (const s of ['types', 'locations', 'packing']) assert.deepEqual(rowsFor(s, { id: 'x', name: 'n', qty: 1 }, ctx).rows, []);
  assert.deepEqual(rowsFor('settings', { key: 'lastFloat', value: 5 }, ctx).rows, []);
  const p = rowsFor('settings', { key: 'staffNames', value: [{ name: 'Luca Dorrough' }, { name: 'Ysis De Gans', hidden: true }, { name: 'Sam' }] }, ctx);
  assert.deepEqual(p.replaceTabs, ['People']);
  assert.deepEqual(p.rows.map(r => r.cells), [['Luca Dorrough', 'Yes'], ['Ysis De Gans', ''], ['Sam', 'Yes']]);
  assert.deepEqual(TABS_OF_STORE.marketDays, ['Market days', 'Cash counts']);
  assert.deepEqual(Object.keys(tabDefs(['Sales'])), ['Sales']);
  assert.equal(hhmm(new Date(2026, 0, 1, 13, 7).getTime()), '13:07');
});
