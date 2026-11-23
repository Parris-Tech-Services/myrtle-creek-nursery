import test from 'node:test';
import assert from 'node:assert/strict';
import { bestCost, priceBasket, dealsFor, unitPriceFor, makeLine } from '../js/pricing.js';

const prices = {
  seedling: { unit: 400, deals: [{ qty: 4, price: 1500 }] },
  punnet: { unit: 500, deals: [{ qty: 5, price: 2000 }] },
  tree: { unit: 0, deals: [] },
};
const S = (qty, x = {}) => ({ group: 'seedling', qty, unitPrice: prices.seedling.unit, lineType: 'normal', ...x });
const P = (qty, x = {}) => ({ group: 'punnet', qty, unitPrice: prices.punnet.unit, lineType: 'normal', ...x });
const total = (lines, g = prices) => priceBasket(lines, dealsFor(g)).total;

test('seedlings: 4=$15, 5=$19, 8=$30, 3=$12', () => {
  for (const [n, c] of [[4, 1500], [5, 1900], [8, 3000], [3, 1200], [0, 0]]) assert.equal(total([S(n)]), c);
});
test('punnets: 5=$20, 6=$25, 10=$40', () => {
  for (const [n, c] of [[5, 2000], [6, 2500], [10, 4000], [4, 2000]]) assert.equal(total([P(n)]), c);
});
test('mixed basket: 4 seedlings + 5 punnets = $35', () => {
  const r = priceBasket([S(4), P(5)], dealsFor(prices));
  assert.equal(r.total, 3500);
  assert.equal(r.dealSavings, 100 + 500);
  assert.deepEqual(r.savingsByGroup, { seedling: 100, punnet: 500 });
});
test('varieties in one group pool together', () => {
  const r = priceBasket([S(2, { productId: 'a' }), S(2, { productId: 'b' })], dealsFor(prices));
  assert.equal(r.total, 1500);
});
test('seconds and discount lines are excluded from deals', () => {
  assert.equal(total([S(3), S(1, { lineType: 'seconds', unitPrice: 200 })]), 1200 + 200);
  assert.equal(total([S(4), S(4, { lineType: 'seconds', unitPrice: 300 })]), 1500 + 1200);
});
test('extra deal: cheapest combination wins', () => {
  const pl = { seedling: { unit: 400, deals: [{ qty: 4, price: 1500 }, { qty: 10, price: 3200 }] } };
  assert.equal(total([S(10)], pl), 3200);   // beats 4+4+2 = 3800
  assert.equal(total([S(12)], pl), 4000);   // 10 + 2 singles
  assert.equal(total([S(14)], pl), 4700);   // 10 + 4
  assert.equal(total([S(9)], pl), 3400);    // 4+4+1
});
test('a deal never costs more than regular price', () => {
  assert.equal(bestCost([100, 100, 100, 100], [{ qty: 4, price: 900 }]), 400);
});
test('tree price: own price, else group unit', () => {
  assert.equal(unitPriceFor({ id: 'fig', group: 'tree', price: 3000 }, prices), 3000);
  assert.equal(unitPriceFor({ id: 'x', group: 'seedling', price: null }, prices), 400);
});
test('a sale line keeps its snapshot price after prices are edited', () => {
  const g = structuredClone(prices), roma = { id: 'roma', group: 'seedling', price: null };
  const line = makeLine(roma, g, 2);
  g.seedling.unit = 999;
  assert.equal(line.unitPrice, 400);
  assert.equal(unitPriceFor(roma, g), 999);
});
