import test from 'node:test';
import assert from 'node:assert/strict';
import { priceBasket, dealsFor, unitPriceFor, gmapAt, groupAt } from '../js/pricing.js';

const g = { punnet: { id: 'punnet', unit: 500, deals: [{ qty: 5, price: 2000 }], locPrices: { wyndham: { unit: 450, deals: [] } } } };

test('a market with its own price overrides unit and deals; others keep the standard', () => {
  assert.equal(groupAt(g.punnet, 'wyndham').unit, 450);
  assert.deepEqual(groupAt(g.punnet, 'wyndham').deals, []);
  assert.equal(gmapAt(g, 'jamison').punnet.unit, 500);
  assert.equal(gmapAt(g, null).punnet.unit, 500);
});

test('a basket at Wyndham is priced at $4.50 with no deal, at Jamison $5 with 5 for $20', () => {
  const at = loc => { const m = gmapAt(g, loc); return priceBasket([{ group: 'punnet', qty: 5, unitPrice: unitPriceFor({ group: 'punnet' }, m), lineType: 'normal' }], dealsFor(m)).total; };
  assert.equal(at('wyndham'), 2250);
  assert.equal(at('jamison'), 2000);
});
