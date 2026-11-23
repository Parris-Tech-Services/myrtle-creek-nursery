import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, toCents, clampQty, MAX_QTY } from '../js/util.js';

test('money text: dollar signs, thousands commas and spaces are fine', () => {
  assert.equal(parseMoney('$150'), 15000);
  assert.equal(parseMoney('1,234.50'), 123450);
  assert.equal(parseMoney(' 150 '), 15000);
  assert.equal(parseMoney('.5'), 50);
  assert.equal(parseMoney('12.345'), 1235);
});
test('money text that is not an amount is rejected, never NaN', () => {
  for (const bad of ['abc', '1.2.3', '', '  ', '1,23', '$', '12abc', null, undefined]) assert.equal(parseMoney(bad), null, String(bad));
  assert.equal(toCents('abc'), 0);
  assert.ok(Number.isInteger(toCents('$9.99')));
});
test('quantities are whole numbers from 0 (or 1) to 999', () => {
  assert.equal(clampQty(5000), MAX_QTY);
  assert.equal(clampQty(-3), 0);
  assert.equal(clampQty(0, 1), 1);
  assert.equal(clampQty('12.6'), 13);
  assert.equal(clampQty('abc'), 0);
});
