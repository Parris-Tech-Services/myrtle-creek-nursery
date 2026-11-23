import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPost, dateLabel, priceLabel, priceLine } from '../js/post.js';

const groups = {
  seedling: { name: 'Seedling', unit: 400, deals: [{ qty: 4, price: 1500 }] },
  punnet: { name: 'Vegetable punnet', unit: 500, deals: [{ qty: 5, price: 2000 }] },
  tree: { name: 'Tree', unit: 3000, deals: [] },
};
const P = (id, name, category, group, price = null) => ({ id, name, category, group, price });
const going = [
  P('zebra', 'Green Zebra', 'Tomato', 'seedling'), P('roma', 'Roma', 'Tomato', 'seedling'), P('stupice', 'Stupice', 'Tomato', 'seedling'),
  P('camp', 'Camp Joy', 'Cherry tomato', 'seedling'), P('thai-e', 'Thai', 'Eggplant', 'seedling'), P('jal', 'Jalapeno', 'Chilli', 'seedling'),
  P('b-purple', 'Purple', 'Basil', 'punnet'), P('b-sweet', 'Sweet', 'Basil', 'punnet'), P('kale-r', 'Red Russian', 'Kale', 'punnet'), P('kale-n', 'Nero di Toscana', 'Kale', 'punnet'),
  P('beet', 'Beetroot', 'Greens & herbs', 'punnet'), P('fig', 'Fig', 'Fruit trees', 'tree', 3000), P('lemon', 'Lemon (Meyer)', 'Fruit trees', 'tree', 3500),
];
const qty = { roma: 20, camp: 4, fig: 2, beet: 10 };
const base = { market: 'Jamison Markets – Canberra', date: '2026-12-06', going, qty, groups, options: { emoji: false } };

test('formatting helpers', () => {
  assert.equal(dateLabel('2026-12-06'), 'Sunday 6 December');
  assert.equal(priceLabel(400), '$4'); assert.equal(priceLabel(450), '$4.50');
  assert.equal(priceLine(groups.seedling), '$4 each or 4 for $15');
});

test('prices come first, grouped, with trees priced individually', () => {
  const { full } = buildPost(base);
  const lines = full.split('\n');
  assert.equal(lines[0], 'Myrtle Creek Nursery at Jamison Markets – Canberra – Sunday 6 December');
  assert.equal(lines[2], 'PRICES');
  assert.ok(full.includes('Seedlings: $4 each or 4 for $15'));
  assert.ok(full.includes('Vegetable punnets: $5 each or 5 for $20'));
  assert.ok(full.includes('Trees: Fig $30 · Lemon (Meyer) $35'));
  assert.ok(full.indexOf('PRICES') < full.indexOf('TOMATOES'));
});

test('varieties are grouped by sub-category, comma separated, sorted', () => {
  const { full } = buildPost(base);
  assert.ok(full.includes('TOMATOES: Green Zebra, Roma, Stupice'));
  assert.ok(/CHERRY TOMATOES: Camp Joy \| CHILLI: Jalapeno \| EGGPLANT: Thai/.test(full));
});

test('punnets merge varieties of one plant and sort alphabetically', () => {
  const { full } = buildPost(base);
  assert.ok(full.includes('VEGETABLE PUNNETS\nBasil (Purple, Sweet) · Beetroot · Kale (Nero di Toscana, Red Russian)'));
});

test('limited numbers and new this week', () => {
  const { full } = buildPost({ ...base, prevIds: new Set(['zebra', 'roma']) });
  assert.ok(full.includes('Limited numbers: Cherry tomato (Camp Joy), Fruit trees (Fig)'));
  assert.ok(full.includes('NEW this week: '));
  assert.ok(!full.includes('Limited numbers: Roma'));
  assert.ok(!/Limited numbers:.*\bPurple\b(?!\))/.test(full));
  assert.equal(buildPost({ ...base, options: { emoji: false, limited: false, fresh: false }, prevIds: new Set(['zebra']) }).full.includes('Limited'), false);
});

test('pickup note and hold line are OFF by default and empty by default', () => {
  const { full, short } = buildPost(base);
  assert.ok(!/pickup|Pambula|hold plants/i.test(full + short));
  const on = buildPost({ ...base, options: { emoji: false, pickup: true, pickupText: 'Pickup by arrangement.', hold: true, signoff: 'Thanks, Myrtle Creek' } }).full.split('\n');
  assert.equal(on.at(-1), 'Message us to hold plants.');           // hold line is the last line
  assert.equal(on.at(-2), 'Pickup by arrangement.');               // directly below the pickup note
  assert.ok(on.indexOf('Thanks, Myrtle Creek') < on.indexOf('Pickup by arrangement.'));
  assert.equal(buildPost({ ...base, options: { emoji: false, hold: true } }).full.split('\n').at(-1), 'Message us to hold plants.');
  // switched on but with no text: nothing printed for the pickup note
  assert.ok(!/Pickup/.test(buildPost({ ...base, options: { emoji: false, pickup: true, pickupText: '  ' } }).full));
});

test('emojis: on adds at most one per heading, off adds none', () => {
  const on = buildPost({ ...base, options: { emoji: true } }).full;
  assert.ok(on.startsWith('🍅 Myrtle Creek'));
  for (const l of on.split('\n')) assert.ok((l.match(/\p{Extended_Pictographic}/gu) || []).length <= 1, l);
  assert.ok(!/\p{Extended_Pictographic}/u.test(buildPost(base).full));
});

test('plain text only, no markdown, and a short version of 2-3 lines', () => {
  const { full, short } = buildPost(base);
  assert.ok(!/[*_#`]/.test(full));
  const n = short.split('\n').length; assert.ok(n >= 2 && n <= 3, short);
  assert.ok(short.includes('seedlings $4 (4 for $15)'.replace(/^s/, 'S')));
});
