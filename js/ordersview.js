import { db, catalog, openDay, adjustStock, markets, NURSERY } from './db.js';
import { dealsFor, unitPriceFor } from './pricing.js';
import { orderTotals, paidTotal, balance, paymentStatus, filterOrders, liability } from './orders.js';
import { flush } from './gsync.js';
import { esc, money, uid, ymd, fmtDate, groupBy, $, $$ } from './util.js';
import { askForm, choose, toast, undoToast, overlay, confirmBox, stepperHtml, stepperClick } from './ui.js';

const FUL = { market: 'Pickup at market', pambula: 'Pickup at Pambula', delivery: 'Drop-off / delivery' };
const METHODS = [['cash', 'Cash'], ['card', 'Card'], ['transfer', 'Transfer / PayID']];

async function saveOrder(o) {
  await db.transaction('rw', db.orders, async () => { await db.orders.put(o); });
  flush();
}

async function takePayment(o, { amount, method, date = ymd() }) {
  const day = await openDay(); // counts toward the open day's cash/card/transfer reconciliation
  o.payments = [...(o.payments || []), { id: uid(), amount, method, date, ts: Date.now(), marketDayId: day?.id || null }];
  await saveOrder(o);
}

/** Day a collection is booked against. Market pickups use the open day at that market; others get a quiet day of their own. */
async function dayForCollection(o) {
  const loc = o.fulfilment === 'pambula' ? 'pambula' : o.fulfilment === 'delivery' ? NURSERY : o.locationId;
  const open = await openDay();
  if (open && open.location === loc) return { day: open, fromStock: 'day', created: false };
  const date = ymd();
  let day = (await db.marketDays.where('location').equals(loc).toArray()).find(d => d.date === date && d.auto);
  const created = !day;
  day ||= { id: uid(), date, location: loc, status: 'closed', float: 0, countedCash: null, notes: 'Order collections', auto: true, closedAt: Date.now() };
  return { day, fromStock: 'nursery', created };
}

/** Counts the units as sold on the collection day. Money was already counted when paid, so the sale carries no payments. */
async function collectOrder(o) {
  if (balance(o) > 0) {
    const c = await choose(`Collect ${o.customer}'s order`, [['pay', `Take ${money(balance(o))} now, then collect`], ['owing', 'Collect without payment (balance stays owing)']], `They still owe ${money(balance(o))}. How do you want to settle it?`);
    if (!c) return false;
    if (c === 'pay') {
      const m = await choose(`Payment of ${money(balance(o))}`, METHODS); if (!m) return false;
      await takePayment(o, { amount: balance(o), method: m });
    }
  }
  const { day, fromStock, created } = await dayForCollection(o);
  const sale = {
    id: uid(), marketDayId: day.id, timestamp: Date.now(), lines: o.lines.map(l => ({ ...l })), dealSavings: o.dealSavings || 0, savingsByGroup: o.savingsByGroup || {},
    total: o.items ?? o.total, paymentMethod: 'order', payments: [], voided: false, fromOrder: o.id,
  };
  Object.assign(o, { status: 'collected', collectedAt: Date.now(), collectedDate: ymd(), collectedDayId: day.id, collectedSaleId: sale.id, stockFrom: fromStock });
  await db.transaction('rw', db.sales, db.orders, db.marketDays, db.stock, async () => {
    if (created) { await db.marketDays.put(day); }
    await db.sales.add(sale);
    if (fromStock === 'nursery') for (const l of o.lines) if (l.productId !== 'misc') await adjustStock(l.productId, -l.qty);
    await db.orders.put(o);
  });
  flush();
  undoToast(`Collected: ${o.customer}`, () => uncollect(o.id));
  return true;
}

async function uncollect(id) {
  const o = await db.orders.get(id);
  await db.transaction('rw', db.sales, db.orders, db.stock, async () => {
    await db.sales.update(o.collectedSaleId, { voided: true, voidedAt: Date.now() });
    if (o.stockFrom === 'nursery') for (const l of o.lines) if (l.productId !== 'misc') await adjustStock(l.productId, l.qty);
    Object.assign(o, { status: 'held', collectedAt: null, collectedDate: null, collectedDayId: null, collectedSaleId: null, stockFrom: null });
    await db.orders.put(o);
  });
  flush();
}

/** Full-screen item picker with live deal pricing. Resolves lines or null. */
function editItems(order, cat) {
  const { products, types, pmap, gmap } = cat, deals = dealsFor(gmap), existing = Object.fromEntries((order.lines || []).map(l => [l.productId, l]));
  const g = groupBy(products.filter(p => p.active || existing[p.id]), p => p.type);
  return new Promise(res => {
    const o = overlay(`<form class="items"><h3>Items for ${esc(order.customer)}</h3><div class="scroll-y">
      ${types.filter(t => g[t.id]).map(t => `<h4>${esc(t.name)}s</h4>${g[t.id].map(p => `<div class="kv"><span>${esc(p.label)} <small>${money(existing[p.id]?.unitPrice ?? unitPriceFor(p, gmap))}</small></span>
        ${stepperHtml(`data-p="${p.id}"`, existing[p.id]?.qty || '', p.label)}</div>`).join('')}`).join('')}</div>
      <div class="total"><span>Items</span><b id="tot"></b></div>
      <div class="row"><button type="button" class="btn ghost" data-x="c">Cancel</button><button class="btn primary">Save items</button></div></form>`);
    const form = o.querySelector('form');
    const lines = () => $$('input[data-p]', form).filter(i => +i.value > 0).map(i => {
      const p = pmap[i.dataset.p], ex = existing[p.id];
      return { productId: p.id, qty: Math.round(+i.value), unitPrice: ex?.unitPrice ?? unitPriceFor(p, gmap), lineType: 'normal', note: ex?.note || '' };
    });
    const upd = () => { $('#tot', form).textContent = money(orderTotals(lines(), deals, id => pmap[id]?.group, order.deliveryFee).items); };
    form.oninput = upd; upd();
    form.onclick = e => { if (stepperClick(e)) return; if (e.target.dataset.x) { o.remove(); res(null); } };
    form.onsubmit = e => { e.preventDefault(); const l = lines(); if (!l.length) return toast('Add at least one item'); o.remove(); res(l); };
  });
}

async function orderForm(existing) {
  const cat = await catalog({ activeOnly: true });
  const m = markets(cat.locations);
  const v = await askForm(existing ? 'Edit order (1 of 2: details)' : 'New order (1 of 2: details)', [
    { name: 'customer', label: 'Customer name' }, { name: 'phone', label: 'Phone (optional)', type: 'tel' },
    { name: 'fulfilment', label: 'How will they get it', type: 'select', options: Object.entries(FUL) },
    { name: 'locationId', label: 'Which market', type: 'select', options: m.map(l => [l.id, l.name]), showWhen: ['fulfilment', ['market']] },
    { name: 'address', label: 'Delivery address', showWhen: ['fulfilment', ['delivery']] }, { name: 'deliveryFee', label: 'Delivery fee (optional)', type: 'money', showWhen: ['fulfilment', ['delivery']] },
    { name: 'dueDate', label: 'Due date', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
    existing || { fulfilment: 'market', locationId: m[0]?.id, dueDate: ymd() }, { submit: 'Next: items' });
  if (!v?.customer) return;
  const base = existing || { id: uid(), created: Date.now(), status: 'held', payments: [], lines: [] };
  const o = { ...base, ...v, deliveryFee: v.fulfilment === 'delivery' ? v.deliveryFee : 0 };
  const lines = await editItems(o, await catalog());
  if (!lines) return;
  const t = orderTotals(lines, dealsFor(cat.gmap), id => cat.pmap[id]?.group, o.deliveryFee);
  Object.assign(o, { lines, items: t.items, dealSavings: t.dealSavings, savingsByGroup: t.savingsByGroup, total: t.total });
  await saveOrder(o);
  toast('Order saved');
}

/** Held market orders for the open day's location, with quick collect. `after` re-renders the caller. */
export async function pickupsFor(day) {
  return (await db.orders.toArray()).filter(o => o.status === 'held' && o.fulfilment === 'market' && o.locationId === day.location).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
}
export async function showPickups(day, after) {
  const { pmap } = await catalog();
  const list = await pickupsFor(day);
  const o = overlay(`<h3>Orders for pickup here</h3>${list.map(x => `<div class="kv"><span><b>${esc(x.customer)}</b> <small>${esc(x.phone)} &middot; due ${fmtDate(x.dueDate)}</small>
    <small>${x.lines.map(l => `${l.qty} x ${esc(pmap[l.productId]?.label || l.name || '?')}`).join(', ')}</small>
    <small>${balance(x) ? 'Owes ' + money(balance(x)) : 'Paid'}</small></span><button class="btn small primary" data-c="${x.id}">Mark collected</button></span></div>`).join('') || '<p>None.</p>'}
    <button class="btn ghost" data-x="1">Close</button>`);
  o.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.c && await collectOrder(list.find(x => x.id === b.dataset.c))) { o.remove(); after?.(); }
    if (b.dataset.x) { o.remove(); after?.(); }
  };
}

let filter = 'open';
export async function render(root) {
  const { pmap, lmap } = await catalog();
  const all = await db.orders.toArray(), today = ymd();
  const list = filterOrders(all, filter, today);
  const FILT = [['open', 'Open'], ['week', 'Due this week'], ['unpaid', 'Unpaid'], ['collected', 'Collected'], ['all', 'All']];
  const badge = o => { const s = paymentStatus(o); return s === 'paid' ? `<span class="tag ok">Paid (${(o.payments || []).map(p => p.method).filter((v, i, a) => a.indexOf(v) === i).join('/')})</span>` : s === 'part' ? `<span class="tag">Part-paid ${money(paidTotal(o))} of ${money(o.total)}</span>` : '<span class="tag bad">Unpaid</span>'; };
  root.innerHTML = `<div class="card"><h2>Orders</h2>
    <div class="kv"><span>Prepaid, not yet collected (owed in plants or refunds)</span><b>${money(liability(all))}</b></div>
    <button class="btn primary big" id="new">New order</button>
    <div class="chips">${FILT.map(([k, l]) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div></div>
    ${list.map(o => `<div class="card order ${o.status}"><div class="kv"><span><b>${esc(o.customer)}</b> <small>${esc(o.phone)}</small></span><b>${money(o.total)}</b></div>
      <p>${esc(FUL[o.fulfilment])}${o.fulfilment === 'market' ? ': ' + esc(lmap[o.locationId]?.name) : ''}${o.fulfilment === 'delivery' ? ': ' + esc(o.address) + (o.deliveryFee ? ` (fee ${money(o.deliveryFee)})` : '') : ''}
      &middot; due ${fmtDate(o.dueDate)}</p>
      <p>${o.lines.map(l => `${l.qty} x ${esc(pmap[l.productId]?.label || l.name || '?')}`).join(', ')}</p>
      ${o.notes ? `<p class="muted">${esc(o.notes)}</p>` : ''}
      <p>${badge(o)} <span class="tag ${o.status === 'held' ? '' : o.status === 'collected' ? 'ok' : 'bad'}">${o.status === 'held' ? 'Held' : o.status === 'collected' ? (o.fulfilment === 'delivery' ? 'Delivered' : 'Collected') + ' ' + fmtDate(o.collectedDate) : 'Cancelled'}</span>
      ${o.status === 'cancelled' && paidTotal(o) && !o.refunded ? '<span class="tag bad">Refund due</span>' : ''}</p>
      <div class="row">${o.status === 'held' ? `<button class="btn small primary" data-c="${o.id}">Mark collected</button>` : ''}
      ${o.status !== 'cancelled' && balance(o) > 0 ? `<button class="btn small" data-pay="${o.id}">Take payment</button>` : ''}
      ${o.status === 'held' ? `<button class="btn small ghost" data-e="${o.id}">Edit</button><button class="btn small ghost" data-x="${o.id}">Cancel order</button>` : ''}
      ${o.status === 'collected' ? `<button class="btn small ghost" data-u="${o.id}">Undo collection</button>` : ''}
      ${o.status === 'cancelled' && paidTotal(o) && !o.refunded ? `<button class="btn small" data-rf="${o.id}">Mark refunded</button>` : ''}</div></div>`).join('') || `<div class="card empty"><h2>No orders yet</h2><p>Orders hold plants for a customer until they collect them.</p><button class="btn primary" id="new2">New order</button></div>`}`;
  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset, get = id => db.orders.get(id);
    if (d.f) { filter = d.f; return render(root); }
    if (b.id === 'new' || b.id === 'new2') await orderForm();
    else if (d.e) await orderForm(await get(d.e));
    else if (d.c) await collectOrder(await get(d.c));
    else if (d.u) { if (await confirmBox('Undo this collection? The sale is voided and stock restored.', 'Undo collection', true)) { await uncollect(d.u); toast('Collection undone'); } }
    else if (d.pay) {
      const o = await get(d.pay);
      const v = await askForm(`Payment from ${o.customer}`, [{ name: 'amount', label: 'Amount', type: 'money' }, { name: 'method', label: 'Method', type: 'select', options: METHODS }, { name: 'date', label: 'Date', type: 'date' }],
        { amount: balance(o), method: 'cash', date: today });
      if (v && v.amount > 0) await takePayment(o, v);
    } else if (d.x) {
      const o = await get(d.x);
      if (await confirmBox(`Cancel ${o.customer}'s order?` + (paidTotal(o) ? `\nThey have paid ${money(paidTotal(o))}; it stays listed as a refund due.` : ''), 'Cancel order', true)) { o.status = 'cancelled'; await saveOrder(o); }
    } else if (d.rf) { const o = await get(d.rf); o.refunded = true; await saveOrder(o); }
    render(root);
  };
}
