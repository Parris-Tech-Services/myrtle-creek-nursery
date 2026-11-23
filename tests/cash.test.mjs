import test from 'node:test';
import assert from 'node:assert/strict';
import { countTotal, breakdown, diffCounts } from '../js/cash.js';

test('count total', () => assert.equal(countTotal({ 5000: 1, 2000: 2, 100: 3, 5: 1 }), 5000 + 4000 + 300 + 5));
test('breakdown of a float uses what was counted first', () => {
  const b = breakdown(10000, { 5000: 0, 2000: 1, 1000: 0, 500: 3, 100: 50 });
  assert.equal(countTotal(b), 10000);
  assert.equal(b[2000], 1); assert.equal(b[500] >= 3, true); assert.equal(b[100] <= 50 + 50, true);
});
test('breakdown without availability is greedy', () => assert.deepEqual(breakdown(8570), { 5000: 1, 2000: 1, 1000: 1, 500: 1, 50: 1, 20: 1 }));
test('diff table', () => {
  const d = diffCounts({ 2000: 2, 100: 10 }, { 2000: 5, 50: 4 });
  assert.deepEqual(d.map(r => [r.denom, r.before, r.after, r.change]), [[2000, 2, 5, 3], [100, 10, 0, -10], [50, 0, 4, 4]]);
});

import { roundCash5, settleCash, describeBreakdown, quickAmounts } from '../js/cash.js';
test('5c cash rounding: 1-2c down, 3-4c up, 6-7c down, 8-9c up', () => {
  const r = Object.fromEntries([1898, 1899, 1900, 1901, 1902, 1903, 1904, 1905, 1906, 1907, 1908, 1909].map(c => [c, roundCash5(c)]));
  assert.deepEqual(r, { 1898: 1900, 1899: 1900, 1900: 1900, 1901: 1900, 1902: 1900, 1903: 1905, 1904: 1905, 1905: 1905, 1906: 1905, 1907: 1905, 1908: 1910, 1909: 1910 });
});
test('settle cash: exact, change, short, rounding adjustment', () => {
  assert.deepEqual(settleCash(1898), { due: 1900, rounding: 2, tendered: 1900, change: 0, short: 0 });
  const s = settleCash(1903, 5000);
  assert.deepEqual(s, { due: 1905, rounding: 2, tendered: 5000, change: 3095, short: 0 });
  assert.equal(settleCash(1901, 2000).rounding, -1);
  assert.deepEqual(settleCash(1900, 1500), { due: 1900, rounding: 0, tendered: 1500, change: 0, short: 400 });
});
test('net cash kept = tendered - change = exact portion + rounding (not double counted)', () => {
  const s = settleCash(1898, 5000);
  assert.equal(s.tendered - s.change, 1898 + s.rounding);
});
test('change breakdown text, largest first', () => {
  assert.equal(describeBreakdown(breakdown(2100)), '1 × $20, 1 × $1');
  assert.equal(describeBreakdown(breakdown(3095)), '1 \u00d7 $20, 1 \u00d7 $10, 1 \u00d7 50c, 2 \u00d7 20c, 1 \u00d7 5c');
});
test('quick amounts above the total', () => {
  assert.deepEqual(quickAmounts(1900), [2000, 5000, 10000]);
  assert.deepEqual(quickAmounts(2000), [5000, 10000]);
  assert.deepEqual(quickAmounts(2200), [2500, 3000, 4000, 5000]);
  assert.deepEqual(quickAmounts(0), []);
});

test('diff table tolerates a float that has not been counted yet (null)', () => assert.deepEqual(diffCounts(null, { 2000: 1 }).map(r => r.after), [1]));
