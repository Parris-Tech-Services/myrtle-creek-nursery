import test from 'node:test';
import assert from 'node:assert/strict';
import { productStats, rollupStats, splitPeriods, trend, rank, highlights, suggestQty, clock, pct } from '../js/insights.js';

const V = (date, taken, sold, extra = {}) => ({ date, taken, sold, revenue: Object.fromEntries(Object.entries(sold).map(([k, n]) => [k, n * 400])), lost: {}, soldOutAt: {}, ...extra });
const visits = [
  V('2026-11-01', { roma: 10, kale: 10 }, { roma: 10, kale: 2 }, { soldOutAt: { roma: 630 } }),
  V('2026-11-08', { roma: 10, kale: 10 }, { roma: 10, kale: 3 }, { soldOutAt: { roma: 600 } }),
  V('2026-11-15', { roma: 10, kale: 10 }, { roma: 8, kale: 4 }, { lost: { kale: 1 } }),
];

test('sell-through = sold / taken; units, revenue, averages, losses, sold-out time', () => {
  const s = productStats(visits);
  assert.equal(s.roma.sold, 28); assert.equal(s.roma.taken, 30);
  assert.ok(Math.abs(s.roma.sellThrough - 28 / 30) < 1e-9);
  assert.ok(Math.abs(s.roma.avgSold - 28 / 3) < 1e-9);
  assert.equal(s.roma.revenue, 28 * 400);
  assert.equal(s.roma.soldOut, 2); assert.equal(s.roma.avgSoldOutMin, 615);
  assert.equal(s.kale.lost, 1); assert.ok(Math.abs(s.kale.sellThrough - 0.3) < 1e-9);
});
test('sell-through ignores visits where nothing was taken', () => {
  const s = productStats([V('d1', { a: 10 }, { a: 5 }), V('d2', {}, { a: 3 })]);
  assert.equal(s.a.sellThrough, 0.5); assert.equal(s.a.sold, 8); assert.equal(s.a.visits, 2);
});
test('ranking: sell-through by default, or units, or revenue', () => {
  const rows = Object.values(productStats([V('d', { big: 100, small: 5 }, { big: 30, small: 5 })]));
  assert.equal(rank(rows)[0].id, 'small'); assert.equal(rank(rows, 'units')[0].id, 'big'); assert.equal(rank(rows, 'revenue')[0].id, 'big');
});
test('roll up by sub-category', () => {
  const cat = id => (id.startsWith('ch') ? 'Cherry' : 'Other');
  const s = rollupStats([V('d', { ch1: 10, ch2: 10, x: 4 }, { ch1: 10, ch2: 4, x: 1 })], cat);
  assert.equal(s.Cherry.taken, 20); assert.equal(s.Cherry.sold, 14); assert.equal(s.Cherry.sellThrough, 0.7);
});
test('periods and trend arrows', () => {
  const many = Array.from({ length: 12 }, (_, i) => V(`2026-${String(i + 1).padStart(2, '0')}-01`, { a: 10 }, { a: i < 6 ? 2 : 8 }));
  const { current, previous } = splitPeriods(many, 6);
  assert.equal(current.length, 6); assert.equal(previous.length, 6);
  const [c, p] = [productStats(current).a, productStats(previous).a];
  assert.equal(trend(c, p), 'up'); assert.equal(trend(p, c), 'down'); assert.equal(trend(c, c), 'flat'); assert.equal(trend(c, undefined), null);
});
test('highlights: top, sells out early, slow (needs 3 visits), does better elsewhere', () => {
  const here = productStats([
    V('1', { roma: 10, kale: 10, basil: 10, mint: 10 }, { roma: 10, kale: 2, basil: 5, mint: 3 }, { soldOutAt: { roma: 600 } }),
    V('2', { roma: 10, kale: 10, basil: 10, mint: 10 }, { roma: 10, kale: 3, basil: 5, mint: 3 }, { soldOutAt: { roma: 640 } }),
    V('3', { roma: 10, kale: 10, basil: 10, mint: 10 }, { roma: 9, kale: 1, basil: 5, mint: 3 }),
  ]);
  const wyndham = productStats([V('a', { mint: 10, kale: 10 }, { mint: 9, kale: 3 }), V('b', { mint: 10, kale: 10 }, { mint: 8, kale: 2 })]);
  const h = highlights(here, { wyndham });
  assert.equal(h.top[0].id, 'roma');
  assert.deepEqual(h.early.map(s => s.id), ['roma']);
  assert.deepEqual(h.slow.map(s => s.id), ['kale', 'mint']);              // 20% and 30%, both over 3 visits
  assert.deepEqual(h.better.map(b => [b.id, b.loc]), [['mint', 'wyndham']]); // 85% there vs 30% here; kale is 25% there vs 20% here (under 20 points)
});
test('suggested quantity and a one-line reason', () => {
  const s = productStats(visits);
  const a = suggestQty({ stats: s.roma, lastTaken: 10, lastSold: 8, stock: 50 });
  assert.equal(a.qty, 13); assert.match(a.reason, /sold out by 10:15am last 2 visits, bring more/);   // max(avg 9.3, taken 10) x 1.3
  const b = suggestQty({ stats: s.kale, lastTaken: 10, lastSold: 4, stock: 50 });
  assert.match(b.reason, /slow here: 30% sold over 3 visits, bring fewer/); assert.ok(b.qty < 10);
  assert.equal(suggestQty({ stats: s.roma, lastTaken: 10, lastSold: 8, held: 3, stock: 12 }).qty, 12);   // capped by stock
  assert.equal(suggestQty({ stats: undefined, held: 2, stock: 9 }).qty, 2);
});
test('formatting', () => { assert.equal(clock(630), '10:30am'); assert.equal(clock(13 * 60 + 5), '1:05pm'); assert.equal(pct(0.456), '46%'); });
