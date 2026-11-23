import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceGuard } from '../js/backup.js';

const device = { sales: 40, products: 45, orders: 5, settings: 3 };

test('replace is refused when the Sheet has no sales and no products', () => {
  assert.match(replaceGuard({ sales: 0, products: 0, orders: 0 }, device).block, /blank or wrong/);
  assert.equal(replaceGuard({ sales: 0, products: 3 }, { sales: 0, products: 3 }).block, undefined);
});
test('replace with a noticeably smaller Sheet needs the user to type REPLACE, and shows both counts', () => {
  const g = replaceGuard({ sales: 10, products: 45, orders: 5 }, device);
  assert.match(g.warn, /10 sales/); assert.match(g.warn, /40 sales/);
  assert.ok(replaceGuard({ sales: 40, products: 10 }, device).warn, 'under 80% of all records even though sales match');
});
test('replace from an equal or larger Sheet is fine, and settings are not counted', () => {
  assert.deepEqual(replaceGuard({ sales: 41, products: 45, orders: 5, settings: 0 }, device), {});
  assert.deepEqual(replaceGuard({ sales: 40, products: 45, orders: 5 }, { ...device, settings: 500 }), {});
});
