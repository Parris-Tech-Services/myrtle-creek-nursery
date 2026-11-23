import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTotals, paidTotal, balance, paymentStatus, reservedByProduct, liability, dueThisWeek, filterOrders, addDays } from '../js/orders.js';

const deals = { seedling: [{ qty: 4, price: 1500 }], punnet: [{ qty: 5, price: 2000 }] };
const groupOf = id => (id.startsWith('s') ? 'seedling' : 'punnet');
const L = (productId, qty, unitPrice) => ({ productId, qty, unitPrice, lineType: 'normal' });

test('order totals use deals and add the delivery fee', () => {
  const t = orderTotals([L('s1', 2, 400), L('s2', 2, 400), L('p1', 5, 500)], deals, groupOf, 800);
  assert.equal(t.items, 1500 + 2000);
  assert.equal(t.dealSavings, 100 + 500);
  assert.equal(t.total, 3500 + 800);
});
test('payment status and balance', () => {
  const o = { total: 3000, payments: [] };
  assert.equal(paymentStatus(o), 'unpaid');
  o.payments.push({ amount: 1000, method: 'cash' });
  assert.equal(paymentStatus(o), 'part'); assert.equal(balance(o), 2000);
  o.payments.push({ amount: 2000, method: 'card' });
  assert.equal(paymentStatus(o), 'paid'); assert.equal(paidTotal(o), 3000); assert.equal(balance(o), 0);
});
test('only held orders reserve stock; location filter', () => {
  const orders = [
    { status: 'held', fulfilment: 'market', locationId: 'wyndham', lines: [L('s1', 2, 1)] },
    { status: 'held', fulfilment: 'pambula', lines: [L('s1', 1, 1), L('p1', 3, 1)] },
    { status: 'collected', fulfilment: 'market', locationId: 'wyndham', lines: [L('s1', 9, 1)] },
    { status: 'cancelled', fulfilment: 'market', locationId: 'wyndham', lines: [L('s1', 9, 1)] },
  ];
  assert.deepEqual(reservedByProduct(orders), { s1: 3, p1: 3 });
  assert.deepEqual(reservedByProduct(orders, 'wyndham'), { s1: 2 });
});
test('liability = prepaid money on uncollected orders (and unrefunded cancellations)', () => {
  const pay = n => [{ amount: n }];
  const orders = [
    { status: 'held', total: 2000, payments: pay(2000) }, { status: 'held', total: 2000, payments: pay(500) },
    { status: 'collected', total: 2000, payments: pay(2000) }, { status: 'cancelled', total: 1000, payments: pay(1000) },
    { status: 'cancelled', total: 1000, payments: pay(1000), refunded: true },
  ];
  assert.equal(liability(orders), 2000 + 500 + 1000);
});
test('due this week and filters', () => {
  assert.equal(addDays('2026-11-28', 7), '2026-12-05');
  const o1 = { status: 'held', dueDate: '2026-11-25', total: 100, payments: [] }, o2 = { status: 'held', dueDate: '2026-12-20', total: 100, payments: [{ amount: 100 }] };
  assert.ok(dueThisWeek(o1, '2026-11-23')); assert.ok(!dueThisWeek(o2, '2026-11-23'));
  assert.equal(filterOrders([o1, o2], 'unpaid', '2026-11-23').length, 1);
  assert.equal(filterOrders([o1, o2], 'open', '2026-11-23')[0], o1);
});
