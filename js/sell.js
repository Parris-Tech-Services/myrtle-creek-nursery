import { db, catalog, openDay, salesForDay, soldByProduct, lossesForDay, lostByProduct, loadVisits, markets } from './db.js';
import { reservedByProduct } from './orders.js';
import { loadBasket, saveBasket } from './basketstore.js';
import { priceBasket, unitPriceFor, dealsFor, makeLine } from './pricing.js';
import { productStats } from './insights.js';
import { flush } from './gsync.js';
import { esc, money, uid, sum, groupBy, ymd, $, $$, fmtDate, clampQty, MAX_QTY } from './util.js';
import { askForm, toast, undoToast, overlay, guard, confirmBox } from './ui.js';
import { changeDialog } from './changecalc.js';
import { pickupsFor, showPickups } from './ordersview.js';
import { checklistCard, wireChecklist } from './checklist.js';

let activeChip = 'all', searchText = '';
let statsCache = { dayId: null, stats: {} };   // best-seller order comes from closed days only, so it cannot change during the day: compute it once per day

/** Filter chips: categories with 3+ products get their own chip; the small ones in a type share one. */
function chipsFor(products, types) {
  const chips = [];
  for (const t of types.filter(t => !t.hidden)) {
    const ps = products.filter(p => p.type === t.id); if (!ps.length) continue;
    const counts = {}; for (const p of ps) counts[p.category || ''] = (counts[p.category || ''] || 0) + 1;
    const big = Object.keys(counts).filter(c => counts[c] >= 3), small = Object.keys(counts).filter(c => counts[c] < 3);
    for (const c of big.sort()) chips.push({ id: `${t.id}/${c}`, label: c || t.name + 's', match: p => p.type === t.id && (p.category || '') === c });
    if (small.length) chips.push({ id: `${t.id}/small`, label: small.length <= 3 ? small.sort().join('/') : t.name + 's', match: p => p.type === t.id && small.includes(p.category || '') });
  }
  return chips;
}

async function noDay(root) {
  const { lmap, locations } = await catalog();
  const days = (await db.marketDays.toArray()).sort((a, b) => b.date.localeCompare(a.date));
  const loc = (days[0] && lmap[days[0].location] && !lmap[days[0].location].hidden ? days[0].location : markets(locations)[0]?.id);
  root.innerHTML = `${await checklistCard()}<div class="card empty"><h2>No market day open</h2><p>Start a day to begin selling.</p>
    <button class="btn primary big" id="startnow">Start selling at ${esc(lmap[loc]?.name || 'a market')} today</button>
    <p><a href="#market">Choose a different place or count the float first</a></p></div>`;
  wireChecklist(root, () => noDay(root));
  $('#startnow', root).onclick = async () => {
    await db.marketDays.put({ id: uid(), date: ymd(), location: loc, status: 'open', startedAt: Date.now(), float: 0, floatCounts: null, floatPending: true, countedCash: null, closedAt: null });
    render(root);
  };
}

export async function render(root) {
  const day = await openDay();
  if (!day) return noDay(root);
  const { types, gmap, products: all, pmap, lmap } = await catalog({ activeOnly: true });
  const dealsByGroup = dealsFor(gmap), price = p => unitPriceFor(p, gmap);
  const taken = Object.fromEntries((await db.dayStock.where('marketDayId').equals(day.id).toArray()).map(r => [r.productId, r.taken]));
  const anyLoaded = Object.keys(taken).length > 0;   // stock warnings only make sense once some stock was loaded for this day
  const sold = soldByProduct(await salesForDay(day.id));
  const lost = lostByProduct(await lossesForDay(day.id));
  const out = new Set((await db.soldOut.where('marketDayId').equals(day.id).toArray()).map(r => r.productId));
  const orders = (await pickupsFor(day)).length;
  if (statsCache.dayId !== day.id) statsCache = { dayId: day.id, stats: productStats(await loadVisits(day.location)) };   // best sellers here first
  const stats = statsCache.stats;
  const heldHere = reservedByProduct(await db.orders.toArray(), day.location);   // reserved for held orders: not for walk-up sales
  const products = [...all].sort((a, b) => (a.category || '').localeCompare(b.category || '') || (stats[b.id]?.sold || 0) - (stats[a.id]?.sold || 0) || a.name.localeCompare(b.name));
  const info = l => pmap[l.productId] || { label: l.name || 'Other item', group: 'misc' };
  let basket = await loadBasket(day.id), soldOutMode = false;   // basket lines: {key, productId, qty, unitPrice, lineType, note}; saved on every change

  const priced = () => priceBasket(basket.map(l => ({ ...l, group: info(l).group })), dealsByGroup);
  const byType = groupBy(products, p => p.type), chips = chipsFor(products, types);
  if (activeChip !== 'all' && !chips.some(c => c.id === activeChip)) activeChip = 'all';

  root.innerHTML = `<div class="sell">
    <div class="grid-wrap">
      <div class="subhead"><span>${esc(lmap[day.location]?.name)} &middot; ${fmtDate(day.date)}</span>
        <span class="btns">${day.floatPending ? '<button class="btn small" id="floatlater">Count float</button>' : ''}${orders ? `<button class="btn small" id="orders">Orders here: ${orders}</button>` : ''}
        <button class="btn small ghost" id="soldout">Sold out</button><button class="btn small ghost" id="misc">Other item</button></span></div>
      ${anyLoaded ? '' : '<p class="muted hint">Stock not loaded today</p>'}
      <div id="modehint" class="banner" hidden>Tap the product that sold out. <button class="linkbtn" id="modecancel">Cancel</button></div>
      <div class="chipbar" role="toolbar" aria-label="Filter products">
        <button class="chip ${activeChip === 'all' ? 'on' : ''}" data-chip="all">All</button>${chips.map(c => `<button class="chip ${activeChip === c.id ? 'on' : ''}" data-chip="${esc(c.id)}">${esc(c.label)}</button>`).join('')}
        <button class="chip" id="searchbtn" aria-label="Search products" aria-expanded="${searchText ? 'true' : 'false'}">Search</button></div>
      <div id="searchrow" ${searchText ? '' : 'hidden'}><input id="search" type="search" placeholder="Type a product name" value="${esc(searchText)}" aria-label="Search products"></div>
      ${types.filter(t => byType[t.id] && !t.hidden).map(t => `<div class="typeblock"><h3>${esc(t.name)}s <small>${[...new Set(byType[t.id].map(p => p.group))].map(g => gmap[g]).filter(g => g && g.deals?.length)
        .map(g => `${money(g.unit)} each or ${g.deals.map(d => `${d.qty} for ${money(d.price)}`).join(', ')}`).join(' | ')}</small></h3>
      ${Object.entries(groupBy(byType[t.id], p => p.category || '')).map(([c, ps]) => `<section class="cat">${c && c !== 'Greens & herbs' ? `<h4>${esc(c)}</h4>` : ''}<div class="tiles">${ps.map(p => `<div class="tw" data-text="${esc((p.label + ' ' + (p.category || '')).toLowerCase())}" data-chipmatch="${esc(chips.filter(ch => ch.match(p)).map(ch => ch.id).join('|'))}">
        <button class="tile g-${p.group} ${out.has(p.id) ? 'out' : ''}" data-p="${p.id}"><b>${esc(p.name)}</b><span>${money(price(p))}</span><i class="left"></i><em class="badge" hidden></em></button>
        <button class="minus" data-minus="${p.id}" aria-label="Remove one ${esc(p.label)}" hidden>&minus;</button></div>`).join('')}</div></section>`).join('')}</div>`).join('')}
    </div>
    <aside class="basket" id="basket" aria-label="Basket"></aside>
    <div class="paybar" id="bar"><button class="bsum" id="bv" aria-live="polite" aria-label="View basket"></button><button class="btn primary big" id="pay">Pay</button></div></div>`;

  const remaining = p => (taken[p] || 0) - (sold[p] || 0) - (lost[p] || 0);   // market stock still on the stall
  const inBasket = p => sum(basket.filter(l => l.productId === p), l => l.qty);
  const left = p => { if (!anyLoaded) return ''; const r = remaining(p) - (heldHere[p] || 0) - inBasket(p); return taken[p] == null && r <= 0 ? '! not loaded' : r < 0 ? `! over by ${-r}` : r === 0 ? '! none left' : `${r} left`; };

  function applyFilter() {
    const q = searchText.trim().toLowerCase();
    $$('.tw', root).forEach(w => { w.hidden = !((activeChip === 'all' || w.dataset.chipmatch.split('|').includes(activeChip)) && (!q || w.dataset.text.includes(q))); });
    $$('.cat', root).forEach(s => { s.hidden = !$$('.tw', s).some(w => !w.hidden); });
    $$('.typeblock', root).forEach(s => { s.hidden = !$$('.cat', s).some(c => !c.hidden); });
  }
  function badges() {
    $$('.tw', root).forEach(w => {
      const t = $('.tile', w), id = t.dataset.p, q = inBasket(id), b = $('.badge', t);
      b.hidden = !q; b.textContent = q; $('.minus', w).hidden = !q; $('.left', t).textContent = left(id); t.classList.toggle('low', anyLoaded && remaining(id) - (heldHere[id] || 0) - q <= 0);
    });
  }
  function draw() {
    const r = priced(), units = sum(basket, l => l.qty), open = $('#basket').classList.contains('open');
    $('#basket').innerHTML = `<h3>Basket <button class="btn small ghost" id="close">Close</button></h3>
      <div class="blines">${basket.length ? basket.map((l, i) => `<div class="bline"><div class="nm"><b>${esc(info(l).label)}</b>
        ${l.lineType !== 'normal' ? `<span class="tag">${l.lineType}${l.note ? ': ' + esc(l.note) : ''}</span>` : ''}<small>${money(l.unitPrice)} each</small></div>
        <div class="r2"><div class="qty"><button data-m="${i}" aria-label="One less">&minus;</button><span>${l.qty}</span><button data-a="${i}" aria-label="One more">+</button></div>
        <div class="amt">${money(l.qty * l.unitPrice)}</div><button class="edit" data-e="${i}">Edit</button></div></div>`).join('') : `<div class="empty"><p>Basket is empty. Tap a product to add it.</p></div>`}
      ${r.dealSavings ? `<div class="save">Deals save the customer ${money(r.dealSavings)}
        ${Object.entries(r.savingsByGroup).map(([t, v]) => `<small>${esc(gmap[t]?.name)}: ${money(v)}</small>`).join('')}</div>` : ''}</div>
      <div class="bfoot"><div class="total" aria-live="polite"><span>Total</span><b>${money(r.total)}</b></div>
      <div class="row"><button class="btn ghost" id="clear" ${basket.length ? '' : 'disabled'}>Clear basket</button>
      <button class="btn primary big" id="charge" ${basket.length ? '' : 'disabled'}>Pay ${money(r.total)}</button></div><button class="btn small ghost" id="undo">Undo last sale</button></div>`;
    $('#basket').classList.toggle('open', open && basket.length > 0);
    $('#bv').innerHTML = units ? `<small>${units} item${units > 1 ? 's' : ''}</small><b>${money(r.total)}</b>` : '<small>Basket empty</small><b>$0.00</b>';
    const allFree = basket.length > 0 && basket.every(l => l.lineType === 'freebie');
    $('#pay').disabled = !units || (r.total <= 0 && !allFree); $('#charge').disabled = $('#pay').disabled;   // $0 only when every line is an explicit freebie
    saveBasket(day.id, basket);
    badges();
  }

  const flash = id => { const t = $(`.tile[data-p="${id}"]`, root); t?.classList.add('flash'); setTimeout(() => t?.classList.remove('flash'), 140); };
  const add = id => {
    if (soldOutMode) return markSoldOut(id);
    const l = basket.find(l => l.productId === id && l.lineType === 'normal');
    if (l) l.qty = Math.min(MAX_QTY, l.qty + 1); else basket.push({ key: uid(), ...makeLine(pmap[id], gmap) });
    draw(); flash(id);
    if (anyLoaded && remaining(id) - (heldHere[id] || 0) - inBasket(id) < 0) toast(`${pmap[id].label}: more than the ${Math.max(0, remaining(id) - (heldHere[id] || 0))} left to sell. The sale is allowed but will show in the end-of-day check.`, 4500);
  };
  const removeOne = id => {
    const i = basket.findIndex(l => l.productId === id && l.lineType === 'normal') >= 0 ? basket.findIndex(l => l.productId === id && l.lineType === 'normal') : basket.findIndex(l => l.productId === id);
    if (i < 0) return; if (--basket[i].qty <= 0) basket.splice(i, 1); draw();
  };

  root.onclick = async e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (t.classList.contains('tile')) return add(d.p);
    if (d.minus) return removeOne(d.minus);
    if (d.chip) { activeChip = d.chip; $$('[data-chip]', root).forEach(c => c.classList.toggle('on', c.dataset.chip === activeChip)); return applyFilter(); }
    if (t.id === 'searchbtn') { const row = $('#searchrow', root); row.hidden = !row.hidden; t.setAttribute('aria-expanded', String(!row.hidden)); if (!row.hidden) $('#search', root).focus(); else { searchText = ''; $('#search', root).value = ''; applyFilter(); } return; }
    if (t.id === 'bv') return $('#basket').classList.add('open');
    if (t.id === 'close') return $('#basket').classList.remove('open');
    if (d.a != null) { basket[+d.a].qty = Math.min(MAX_QTY, basket[+d.a].qty + 1); return draw(); }
    if (d.m != null) { const l = basket[+d.m]; if (--l.qty <= 0) basket.splice(+d.m, 1); return draw(); }
    if (t.id === 'clear') { basket = []; return draw(); }
    if (d.e != null) return editLine(+d.e);
    if (t.id === 'charge' || t.id === 'pay') return charge();
    if (t.id === 'undo') return undo();
    if (t.id === 'orders') return showPickups(day, () => render(root));
    if (t.id === 'misc') return misc();
    if (t.id === 'soldout') { soldOutMode = true; $('#modehint').hidden = false; return; }
    if (t.id === 'modecancel') { soldOutMode = false; $('#modehint').hidden = true; return; }
    if (t.id === 'floatlater') {
      const { cashCalc } = await import('./market.js'), c = await cashCalc('Count the opening float', day.floatCounts || {}); if (!c) return;
      const { countTotal } = await import('./cash.js');
      await db.marketDays.put({ ...day, floatCounts: c, float: countTotal(c), floatPending: false }); return render(root);
    }
  };
  root.oninput = e => { if (e.target.id === 'search') { searchText = e.target.value; applyFilter(); } };

  async function markSoldOut(id) {   // two taps: Sold out, then the product. Time is now.
    soldOutMode = false; $('#modehint').hidden = true;
    if (!(sold[id] > 0) && !await confirmBox(`No sales of ${pmap[id].label} recorded today. Mark sold out anyway?`, 'Mark sold out')) return;
    const rec = { id: uid(), marketDayId: day.id, productId: id, ts: Date.now() };
    await db.soldOut.put(rec);
    undoToast(`${pmap[id].label}: sold out at ${new Date(rec.ts).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`, async () => { await db.soldOut.delete(rec.id); render(root); });
    render(root);
  }

  async function editLine(i) {
    const l = basket[i], isMisc = l.productId === 'misc';
    const v = await askForm(info(l).label, [
      { name: 'qty', label: 'Quantity', type: 'number', min: 1 },
      { name: 'lineType', label: 'Line type', type: 'select', options: [['normal', 'Normal (joins deals)'], ['seconds', 'Seconds'], ['discount', 'Discount'], ['freebie', 'Freebie (no charge)']] },
      { name: 'unitPrice', label: 'Price each', type: 'money', hint: 'Seconds, discounts and freebies never join multi-buy deals. Prices cannot be negative.' },
      { name: 'note', label: 'Note' }], l, { extra: [['remove', 'Remove']] });
    if (!v) return;
    if (v._action === 'remove' || !(v.qty > 0)) basket.splice(i, 1);
    else {
      if (isMisc) Object.assign(l, { qty: clampQty(v.qty, 1), unitPrice: v.unitPrice, note: v.note, lineType: 'other' });
      else Object.assign(l, { qty: clampQty(v.qty, 1), lineType: v.lineType, note: v.note, unitPrice: v.lineType === 'normal' ? price(pmap[l.productId]) : v.lineType === 'freebie' ? 0 : v.unitPrice });
      const twin = !isMisc && basket.find(x => x !== l && x.productId === l.productId && x.lineType === 'normal' && l.lineType === 'normal');
      if (twin) { twin.qty = Math.min(MAX_QTY, twin.qty + l.qty); basket.splice(basket.indexOf(l), 1); }
    }
    draw();
  }

  /** Pay sheet: three huge buttons. Split payment is the quiet option underneath. */
  function payChoice(total) {
    return new Promise(res => {
      const o = overlay(`<h3>Pay ${money(total)}</h3><button class="btn primary big" data-m="cash">Cash</button><button class="btn primary big" data-m="card">Card</button>
        <button class="btn primary big" data-m="transfer">Transfer / PayID</button><div class="row"><button class="btn ghost" data-m="split">Split payment</button><button class="btn ghost" data-m="">Cancel</button></div>`);
      o.onclick = e => { const b = e.target.closest('button'); if (!b && e.target !== o) return; o.remove(); res(b?.dataset.m || null); };
    });
  }

  const charge = () => guard('pay', async () => {   // a second tap while paying does nothing
    const r = priced(); if (!basket.length) return;
    const free = r.total === 0 && basket.every(l => l.lineType === 'freebie');
    if (r.total <= 0 && !free) return toast('Nothing to pay. Mark the lines as freebies to give them away.');
    const m = free ? 'none' : await payChoice(r.total);
    if (!m) return;
    let payments = free ? [] : [{ method: m, amount: r.total }];
    if (m === 'split') {
      const v = await askForm('Split payment', [
        { name: 'cash', label: 'Cash', type: 'money' }, { name: 'card', label: 'Card', type: 'money' }, { name: 'transfer', label: 'Transfer / PayID', type: 'money' }], {}, { submit: 'Next' });
      if (!v) return;
      payments = ['cash', 'card', 'transfer'].filter(k => v[k] > 0).map(k => ({ method: k, amount: v[k] }));
      if (sum(payments, p => p.amount) !== r.total) return toast(`Amounts must add up to ${money(r.total)}`, 3500);
    }
    // Cash: change calculator (optional; Exact or Done with nothing entered is exact cash). Only the cash part is rounded to 5c.
    let cash = { rounding: 0 };
    const cashPay = payments.find(p => p.method === 'cash');
    if (cashPay) {
      const c = await changeDialog(cashPay.amount);
      if (!c) return;
      cash = c;
      if (c.rest) {   // short: they handed over less, the remainder goes on card or transfer
        cashPay.amount = c.cashAmount;
        const other = payments.find(p => p.method === c.rest.method);
        other ? (other.amount += c.rest.amount) : payments.push({ method: c.rest.method, amount: c.rest.amount });
        if (cashPay.amount <= 0) payments.splice(payments.indexOf(cashPay), 1);
      }
    }
    const sale = {
      id: uid(), marketDayId: day.id, timestamp: Date.now(),
      lines: basket.map(({ productId, qty, unitPrice, lineType, note, name }) => ({ productId, qty, unitPrice, lineType, note, ...(name ? { name } : {}) })),
      dealSavings: r.dealSavings, savingsByGroup: r.savingsByGroup, total: r.total,
      paymentMethod: free ? 'none' : payments.length > 1 ? 'split' : payments[0].method, payments, voided: false,
      ...(cashPay ? { rounding: cash.rounding, cashTendered: cash.tendered, changeGiven: cash.change } : {}),
    };
    await db.transaction('rw', db.sales, db.settings, async () => { await db.sales.add(sale); await db.settings.delete('basket'); });   // the sale and the empty basket are saved together
    basket = [];
    flush();
    await render(root);   // basket is empty again for the next customer
    undoToast(`Sale saved ✓ ${money(sale.total)}`, async () => { await voidSale(sale.id); render(root); });
  });

  async function voidSale(id) {
    await db.transaction('rw', db.sales, async () => { await db.sales.update(id, { voided: true, voidedAt: Date.now() }); });
    flush();
  }
  const undo = () => guard('undo', async () => {
    const last = (await salesForDay(day.id)).filter(s => !s.fromOrder).pop();
    if (!last) return toast('No sales to undo');
    await voidSale(last.id); render(root);
    undoToast(`Sale removed \u00b7 ${money(last.total)}`, async () => { await db.sales.update(last.id, { voided: false, voidedAt: null }); render(root); }, 'Restore');
  });
  async function misc() {
    const v = await askForm('Other item', [{ name: 'name', label: 'What is it?' }, { name: 'unitPrice', label: 'Price each', type: 'money' }, { name: 'qty', label: 'Quantity', type: 'number' }], { qty: 1 }, { submit: 'Add to basket' });
    if (!v?.name || !(v.unitPrice > 0) || !(v.qty > 0)) return;
    basket.push({ key: uid(), productId: 'misc', name: v.name, qty: Math.round(v.qty), unitPrice: v.unitPrice, lineType: 'other', note: '' }); draw();
  }
  applyFilter();
  draw();
}
