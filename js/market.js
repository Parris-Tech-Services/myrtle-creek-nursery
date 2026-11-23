import { db, getPeople, setPeople, catalog, openDay, salesForDay, soldByProduct, dayReceipts, dayCash, owed, adjustStock, nurseryStock, packingPlan, lossesForDay, lostByProduct, LOSS_REASONS, NURSERY } from './db.js';
import { unitPriceFor } from './pricing.js';
import { DENOMS, denomLabel, countTotal, breakdown, diffCounts } from './cash.js';
import { flush, ackedSet, getConn } from './gsync.js';
import { esc, money, uid, sum, ymd, fmtDate, $, $$, groupBy } from './util.js';
import { showPostDialog } from './postview.js';
import { personHours, displayNames } from './staff.js';
import { askForm, toast, undoToast, overlay, confirmBox, stepperHtml, stepperClick } from './ui.js';
import { checklistCard, wireChecklist } from './checklist.js';

let mode = 'main', viewDayId = null, endStep = 1;
export const showReport = id => { mode = 'end'; viewDayId = id; endStep = 1; location.hash = '#market'; };
const WEATHER = [['sunny', 'Sunny'], ['hot', 'Hot'], ['rain', 'Rain'], ['wind', 'Windy'], ['cold', 'Cold']];
const EXPENSE = [['stallfee', 'Stall fee'], ['fuel', 'Fuel'], ['supplies', 'Supplies'], ['borrowed', 'Borrowed from the float (I will repay)'], ['other', 'Other']];
const CATNAME = Object.fromEntries(EXPENSE);

const saveDay = async (day, patch) => {
  Object.assign(day, patch);
  await db.transaction('rw', db.marketDays, async () => { await db.marketDays.put(day); });
  flush();
};

/** Record plant losses at a market day (day given) or at the nursery (day null: also reduces nursery stock). */
export async function recordLoss(day) {
  const { products, gmap } = await catalog({ activeOnly: true });
  const v = await askForm(day ? 'Record loss at this market' : 'Record loss at the nursery', [
    { name: 'productId', label: 'Product', type: 'select', options: products.map(p => [p.id, p.label]) },
    { name: 'qty', label: 'Quantity', type: 'number' }, { name: 'reason', label: 'Reason', type: 'select', options: LOSS_REASONS }, { name: 'note', label: 'Note' }], { qty: 1, reason: 'dead' });
  if (!v || !(v.qty > 0)) return false;
  const p = products.find(x => x.id === v.productId), qty = Math.round(v.qty);
  const loss = { id: uid(), productId: p.id, qty, reason: v.reason, note: v.note, unitPrice: unitPriceFor(p, gmap), date: day?.date || ymd(), ts: Date.now(), marketDayId: day?.id || null, locationId: day?.location || NURSERY };
  await db.transaction('rw', db.losses, db.stock, async () => { await db.losses.add(loss); if (!day) await adjustStock(p.id, -qty); });
  undoToast(`${qty} x ${p.label} lost`, async () => { await db.transaction('rw', db.losses, db.stock, async () => { await db.losses.delete(loss.id); if (!day) await adjustStock(p.id, qty); }); window.dispatchEvent(new Event('hashchange')); });
  return true;
}

export async function render(root) {
  const open = await openDay();
  if (mode === 'load' && open) return loadView(root, open);
  if (mode === 'end') { const d = await db.marketDays.get(viewDayId || open?.id); if (d) return endView(root, d); }
  mode = 'main';
  return open ? mainOpen(root, open) : mainStart(root);
}
const go = (root, m, id = null) => { mode = m; viewDayId = id; render(root); };

async function owedCard() {
  const o = await owed();
  return `<div class="card ${o.total ? 'warn' : ''}"><h3>Owed to the business: ${money(o.total)}</h3>
    ${o.list.map(m => `<div class="kv"><span>${fmtDate(m.date)} ${esc(m.note)}</span><b>${money(m.remaining)}</b></div>`).join('') || '<p class="muted">Nothing outstanding.</p>'}
    ${o.total ? '<button class="btn" id="repay">Record repayment</button>' : ''}</div>`;
}

function wireOwed(root, day) {
  $('#repay', root)?.addEventListener('click', async () => {
    const o = await owed();
    const v = await askForm('Record repayment (transfer / PayID)', [
      { name: 'linksTo', label: 'Which cash out', type: 'select', options: o.list.map(m => [m.id, `${m.date} ${m.note} (${money(m.remaining)} left)`]) },
      { name: 'amount', label: 'Amount paid back', type: 'money' }, { name: 'method', label: 'Paid back by', type: 'select', options: [['transfer', 'Transfer / PayID'], ['cash', 'Cash into the float (counts toward the open day)']] }, { name: 'date', label: 'Date repaid', type: 'date' }],
      { amount: o.list[0]?.remaining, date: ymd(), linksTo: o.list[0]?.id, method: 'transfer' });
    if (!v || v.amount <= 0) return;
    await db.cashMovements.add({ id: uid(), marketDayId: day?.id || null, type: 'repaid', linksTo: v.linksTo, amount: v.amount, method: v.method, date: v.date, note: v.method === 'cash' ? 'Repaid in cash' : 'Repaid by transfer / PayID', ts: Date.now() });
    toast('Repayment recorded'); render(root);
  });
}

/** Day notes: weather and crowd as tap chips, free notes, set-up/pack-up times, and who was there. Saved on every tap. */
async function notesCard(day) {
  const people = await getPeople(), onDay = (day.staff || []).map(p => p.name);
  const all = [...new Set([...people.filter(p => !p.hidden).map(p => p.name), ...onDay])].sort((a, b) => a.localeCompare(b)), short = displayNames(all);
  const chip = (attr, v, label, on) => `<button class="chip ${on ? 'on' : ''}" data-${attr}="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
  return `<div class="card"><h3>Day notes</h3>
    <div class="chips">${WEATHER.map(([k, l]) => chip('w', k, l, day.weather === k)).join('')}</div>
    <div class="chips"><span class="muted" style="align-self:center">Crowd</span>${[1, 2, 3, 4, 5].map(n => chip('c', n, n, day.crowd === n)).join('')}</div>
    <label><span>Notes</span><textarea id="dnotes" rows="2">${esc(day.notes || '')}</textarea></label>
    <div class="row"><label><span>Set-up time</span><input type="time" id="setup" value="${esc(day.setupTime || '')}"></label><label><span>Pack-up time</span><input type="time" id="packup" value="${esc(day.packupTime || '')}"></label></div>
    <h4>Who was there</h4>
    <div class="chips">${all.map(n => chip('who', n, short[n], onDay.includes(n))).join('')}<button class="chip" id="addwho">Add name</button></div>
    ${(day.staff || []).map((p, i) => `<div class="kv"><span>${esc(p.name)}${personHours(p, day) != null ? `<small>${personHours(p, day)} h</small>` : ''}</span>
      <span class="row"><input type="time" data-arr="${i}" value="${esc(p.arrive || '')}" aria-label="${esc(p.name)} arrives"><input type="time" data-lv="${i}" value="${esc(p.leave || '')}" aria-label="${esc(p.name)} leaves"></span></div>`).join('')}</div>`;
}
async function notesClick(e, day, root) {
  const b = e.target.closest('button'); if (!b) return false; const d = b.dataset;
  if (d.w != null) await saveDay(day, { weather: day.weather === d.w ? '' : d.w });
  else if (d.c != null) await saveDay(day, { crowd: day.crowd === +d.c ? null : +d.c });
  else if (d.who != null) {
    const has = (day.staff || []).some(p => p.name === d.who);
    await saveDay(day, { staff: has ? day.staff.filter(p => p.name !== d.who) : [...(day.staff || []), { name: d.who, arrive: '', leave: '' }] });
  } else if (b.id === 'addwho') {
    const v = await askForm('Add a name', [{ name: 'name', label: 'Name' }]);
    if (!v?.name) return true;
    const people = await getPeople();
    if (!people.some(p => p.name === v.name)) await setPeople([...people, { name: v.name }]);
    if (!(day.staff || []).some(p => p.name === v.name)) await saveDay(day, { staff: [...(day.staff || []), { name: v.name, arrive: '', leave: '' }] });
  } else return false;
  render(root); return true;
}
async function notesChange(e, day, root) {
  const i = e.target, d = i.dataset;
  if (i.id === 'dnotes') await saveDay(day, { notes: i.value });
  else if (i.id === 'setup') { await saveDay(day, { setupTime: i.value }); render(root); }
  else if (i.id === 'packup') { await saveDay(day, { packupTime: i.value }); render(root); }
  else if (d.arr != null || d.lv != null) {
    const staff = day.staff.map(p => ({ ...p })), k = d.arr != null ? +d.arr : +d.lv;
    staff[k][d.arr != null ? 'arrive' : 'leave'] = i.value;
    await saveDay(day, { staff }); render(root);
  } else return false;
  return true;
}

async function expenseForm(day) {
  const had = (await db.cashMovements.where('marketDayId').equals(day.id).toArray()).some(m => m.category === 'stallfee');
  const usual = ((await db.settings.get('stallFees'))?.value || {})[day.location] || 0;   // remembered per location
  const v = await askForm('Cash out / expense', [
    { name: 'category', label: 'What is it', type: 'select', options: EXPENSE }, { name: 'amount', label: 'Amount', type: 'money', hint: had ? '' : 'Stall fee is prefilled with the usual fee here. Change the amount for other expenses.' },
    { name: 'method', label: 'Paid from', type: 'select', options: [['cash', 'Float'], ['card', 'Card'], ['transfer', 'Transfer / PayID']] }, { name: 'note', label: 'Note (e.g. bought pots)' }],
    { method: 'cash', category: had ? 'fuel' : 'stallfee', amount: had ? 0 : usual });
  if (!v || v.amount <= 0) return false;
  const fromFloat = v.method === 'cash' || v.category === 'borrowed';
  await db.cashMovements.add({ id: uid(), marketDayId: day.id, type: fromFloat ? 'cashOut' : 'expense', category: v.category, method: fromFloat ? 'cash' : v.method, amount: v.amount, note: v.note, date: day.date, ts: Date.now() });
  if (v.category === 'stallfee') { const m = (await db.settings.get('stallFees'))?.value || {}; await db.settings.put({ key: 'stallFees', value: { ...m, [day.location]: v.amount } }); }
  return true;
}

async function mainStart(root) {
  const { lmap, locations } = await catalog();
  const days = (await db.marketDays.toArray()).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 20);
  const totals = Object.fromEntries(await Promise.all(days.map(async d => [d.id, sum(await salesForDay(d.id), s => s.total)])));
  root.innerHTML = `${await checklistCard()}<div class="card"><h2>Market day</h2><p>No day is open. Start one to sell, load stock and check the takings.</p><button class="btn primary big" id="start">Start market day</button><button class="btn" id="post">Make a post for an upcoming market</button></div>
    ${await owedCard()}
    <div class="card"><h3>Recent days</h3>${days.map(d => `<div class="kv"><span>${fmtDate(d.date)} &middot; ${esc(lmap[d.location]?.name)} <small>${d.status}</small></span>
      <span>${money(totals[d.id])} <button class="btn small" data-r="${d.id}">Report</button>
      ${d.status === 'closed' && !d.auto ? `<button class="btn small ghost" data-reopen="${d.id}">Reopen</button>` : ''}</span></div>`).join('') || '<p class="muted">No days yet.</p>'}</div>`;
  wireChecklist(root, () => render(root));
  $('#post', root).onclick = () => showPostDialog();
  $('#start', root).onclick = async () => {
    const v = await askForm('Start market day', [
      { name: 'date', label: 'Date', type: 'date' }, { name: 'location', label: 'Location', type: 'select', options: locations.filter(l => !l.hidden).map(l => [l.id, l.name]) },
      { name: 'notes', label: 'Notes', type: 'textarea' }],
      { date: ymd(), location: locations.find(l => l.id !== NURSERY)?.id }, { submit: 'Next: count the float' });
    if (!v) return;
    const next = (await db.settings.get('nextFloat'))?.value;
    const counts = await cashCalc(next ? `Opening float (prefilled from the ${money(next.amount)} you kept last time; change if different)` : 'Count the opening float', next?.counts || {}, { skip: true });
    if (!counts) return;
    await saveDay({ id: uid(), status: 'open', countedCash: null, closedAt: null }, counts.later ? { ...v, floatCounts: null, float: 0, floatPending: true } : { ...v, floatCounts: counts, float: countTotal(counts) });
    toast('Day started'); go(root, 'load');
  };
  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.r) go(root, 'end', b.dataset.r);
    if (b.dataset.reopen) {
      if (await openDay()) return toast('Close the open day first');
      await saveDay(await db.marketDays.get(b.dataset.reopen), { status: 'open', closedAt: null }); render(root);
    }
  };
  wireOwed(root, null);
}

const LABEL = { cashOut: 'Cash out', expense: 'Expense', float: 'Float added', repaid: 'Repaid' };
async function mainOpen(root, day) {
  const { lmap, pmap } = await catalog();
  const sales = await salesForDay(day.id), { movements, expected, expenses } = await dayCash(day, sales);
  const acked = await ackedSet(), connected = !!(await getConn());
  root.innerHTML = `<div class="card"><h2>${esc(lmap[day.location]?.name)}</h2><p>${fmtDate(day.date)} &middot; open
    ${day.weather ? ' &middot; ' + esc(day.weather) : ''}${day.crowd ? ' &middot; crowd ' + day.crowd + '/5' : ''}</p>
    <div class="kv"><span>Sales</span><b>${sales.length} &middot; ${money(sum(sales, s => s.total))}</b></div>
    <div class="kv"><span>Expenses so far</span><b>${money(expenses)}</b></div>
    <div class="kv"><span>Opening float</span><b>${money(day.float)}</b></div>
    <div class="kv"><span>Cash expected in float</span><b>${money(expected)}</b></div>
    ${day.floatPending ? '<div class="banner">The opening float has not been counted. <button class="btn small" id="refloat">Count float</button></div>' : ''}
    <div class="row"><a class="btn primary big" href="#sell">Sell</a><button class="btn big" id="load">Load stock</button></div>
    <div class="row"><button class="btn" id="loss">Record loss</button><button class="btn" id="out">Cash out / expense</button><button class="btn" id="float">Add float (count)</button><button class="btn" id="refloat">Recount opening float</button></div>
    <button class="btn big" id="end">End day: check the takings</button></div>
    ${await notesCard(day)}
    <div class="card"><h3>Cash movements and expenses today</h3>${movements.map(m => `<div class="kv"><span>${LABEL[m.type]}${m.category ? ' (' + (CATNAME[m.category] || m.category) + ')' : ''} ${esc(m.note)}</span>
      <span>${money(m.amount)} <button class="btn small ghost" data-del="${m.id}">Delete</button></span></div>`).join('') || '<p class="muted">None.</p>'}</div>
    <div class="card"><h3>Recent sales</h3>${sales.slice(-10).reverse().map(x => `<div class="kv"><span>${new Date(x.timestamp).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
      <small>${x.lines.map(l => `${l.qty} x ${esc(pmap[l.productId]?.label || l.name || '?')}`).join(', ')}</small></span>
      <span>${money(x.total)} ${connected ? (acked('sales', x) ? '<span class="sale-ok" title="Saved to Google Sheet">\u2713</span>' : '<small>waiting</small>') : ''}</span></div>`).join('') || '<p class="muted">No sales yet today.</p>'}</div>
    ${await owedCard()}`;
  root.onchange = e => notesChange(e, day, root);
  root.onclick = async e => {
    if (await notesClick(e, day, root)) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'load') return go(root, 'load');
    if (b.id === 'end') { endStep = 1; return go(root, 'end', day.id); }
    if (b.dataset.del) { if (await confirmBox('Delete this entry?', 'Delete', true)) { await db.cashMovements.delete(b.dataset.del); render(root); } return; }
    if (b.id === 'loss') { await recordLoss(day); return; }
    if (b.id === 'out') { await expenseForm(day); return render(root); }
    if (b.id === 'float') {
      const c = await cashCalc('Count the extra float you are adding');
      if (c && countTotal(c) > 0) await db.cashMovements.add({ id: uid(), marketDayId: day.id, type: 'float', amount: countTotal(c), counts: c, note: '', date: day.date, ts: Date.now() });
      render(root);
    }
    if (b.id === 'refloat') {
      const c = await cashCalc('Recount the opening float', day.floatCounts || {});
      if (c) await saveDay(day, { floatCounts: c, float: countTotal(c), floatPending: false });
      render(root);
    }
  };
  wireOwed(root, day);
}

async function loadView(root, day) {
  const { products, types, lmap } = await catalog({ activeOnly: true });
  const plan = Object.fromEntries((await packingPlan(day.location)).map(r => [r.product.id, r]));
  const stock = await nurseryStock();
  const have = Object.fromEntries((await db.dayStock.where('marketDayId').equals(day.id).toArray()).map(r => [r.productId, r]));
  const g = groupBy(products, p => p.type);
  root.innerHTML = `<div class="card"><h2>Load stock</h2><p>${esc(lmap[day.location]?.name)}. How many of each are you taking? Prefilled from the packing list. Saving takes them off nursery stock.</p>
    ${types.filter(t => g[t.id]).map(t => `<h3>${esc(t.name)}s</h3>${g[t.id].map(p => `<div class="kv"><span>${esc(p.label)} <small>nursery ${stock[p.id] || 0}</small></span>
      ${stepperHtml(`data-p="${p.id}"`, have[p.id]?.taken ?? plan[p.id]?.qty ?? 0, p.label)}</div>`).join('')}`).join('')}
    <div class="row"><button class="btn ghost" id="back">Back</button><button class="btn primary big" id="save">Save loaded stock</button></div></div>`;
  root.onclick = e => stepperClick(e);
  $('#back', root).onclick = () => go(root, 'main');
  $('#save', root).onclick = async () => {
    const changes = [];
    await db.transaction('rw', db.dayStock, db.stock, async () => {
      for (const i of $$('input[data-p]', root)) {
        const p = i.dataset.p, n = Math.max(0, Math.round(+i.value || 0)), old = have[p]?.taken || 0;
        if (n === old && have[p]) continue;
        changes.push({ p, n, old, ret: have[p]?.returned ?? null, had: !!have[p] });
        await adjustStock(p, old - n);
        await db.dayStock.put({ id: day.id + '|' + p, marketDayId: day.id, productId: p, taken: n, returned: have[p]?.returned ?? null });
      }
    });
    go(root, 'main');
    undoToast('Stock loaded', async () => db.transaction('rw', db.dayStock, db.stock, async () => {
      for (const c of changes) { await adjustStock(c.p, c.n - c.old); c.had ? await db.dayStock.put({ id: day.id + '|' + c.p, marketDayId: day.id, productId: c.p, taken: c.old, returned: c.ret }) : await db.dayStock.delete(day.id + '|' + c.p); }
    }));
  };
}

/** Big-number cash counter for AUD notes and coins. Resolves counts {denom: n} or null if cancelled. */
export function cashCalc(title, initial = {}, { skip = false } = {}) {
  return new Promise(res => {
    const o = overlay(`<form class="calc"><h3>${esc(title)}</h3><div class="big-total" id="ct">$0.00</div>
      <div class="scroll-y">${DENOMS.map(c => `<div class="kv"><span class="den">${denomLabel(c)}</span><span class="qty"><button type="button" data-d="${c}" data-n="-1">-</button>
        <input class="num" type="number" inputmode="numeric" min="0" data-c="${c}" placeholder="0" value="${initial[c] || ''}"><button type="button" data-d="${c}" data-n="1">+</button></span></div>`).join('')}</div>
      ${skip ? '<button type="button" class="btn ghost" data-later="1">Count float later</button>' : ''}
      <div class="row"><button type="button" class="btn ghost" data-x="1">Cancel</button><button class="btn primary big">Use this total</button></div></form>`);
    const f = o.querySelector('form'), counts = () => Object.fromEntries($$('input[data-c]', f).filter(i => +i.value > 0).map(i => [i.dataset.c, Math.round(+i.value)]));
    const upd = () => { f.querySelector('#ct').textContent = money(countTotal(counts())); };
    upd(); f.oninput = upd;
    f.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.x) { o.remove(); res(null); }
      if (b.dataset.later) { o.remove(); res({ later: true }); }
      if (b.dataset.d) { const i = f.querySelector(`input[data-c="${b.dataset.d}"]`); i.value = Math.max(0, (+i.value || 0) + +b.dataset.n); upd(); }
    };
    f.onsubmit = e => { e.preventDefault(); const c = counts(); o.remove(); res(c); };
  });
}

const STEPS = ['Count what is coming home', 'Count the cash', 'Card and Transfer / PayID', 'Summary and close'];
async function endView(root, day) {
  const { products, lmap } = await catalog();
  const sales = await salesForDay(day.id), sold = soldByProduct(sales), pay = await dayReceipts(day.id, sales);
  const { expected, expenses } = await dayCash(day, sales);
  const lost = lostByProduct(await lossesForDay(day.id));
  const ds = Object.fromEntries((await db.dayStock.where('marketDayId').equals(day.id).toArray()).map(r => [r.productId, r]));
  const rows = products.filter(p => ds[p.id]?.taken > 0 || sold[p.id] > 0 || lost[p.id] > 0);
  const rowsCash = diffCounts(day.floatCounts, day.closeCounts);
  const closed = day.status === 'closed', salesTotal = sum(sales, s => s.total), step = closed ? 0 : endStep;
  const show = n => closed || step === n;

  /** Status of one product row. Oversold (sold + lost more than loaded) is flagged even before a returned count is typed. */
  const status = (p, v) => {
    const taken = ds[p]?.taken || 0, over = (sold[p] || 0) + (lost[p] || 0) - taken;
    if (v === '' || v == null) return over > 0 ? { text: `oversold by ${over} (sold more than loaded)`, cls: 'bad', bad: 1 } : { text: '', cls: '', missing: 1 };
    const d = taken - +v - (sold[p] || 0) - (lost[p] || 0);
    return { text: d === 0 ? 'OK' : d > 0 ? `${d} unaccounted` : over > 0 ? `oversold by ${over} (sold more than loaded)` : `${-d} more gone than recorded`, cls: d ? 'bad' : 'ok', bad: d ? 1 : 0 };
  };
  const tally = () => rows.reduce((t, p) => { const s = status(p.id, ds[p.id]?.returned); return { bad: t.bad + (s.bad || 0), missing: t.missing + (s.missing || 0) }; }, { bad: 0, missing: 0 });
  const t0 = tally(), issues = [t0.missing && `${t0.missing} product(s) have no home count`, t0.bad && `${t0.bad} product(s) do not add up`].filter(Boolean);

  const s1 = `<h3>${closed ? 'Stock' : 'Step 1. Count what is coming home'}</h3><p class="muted">Enter how many of each are coming back. Taken minus returned should equal sold plus lost.</p>
    <table class="t" id="rec"><tr><th>Product</th><th>Taken</th><th>Sold</th><th>Lost</th><th>Coming home</th><th></th></tr>
    ${rows.map(p => { const s = status(p.id, ds[p.id]?.returned); return `<tr data-p="${p.id}"><td>${esc(p.label)}</td><td>${ds[p.id]?.taken || 0}</td><td>${sold[p.id] || 0}</td><td>${lost[p.id] || 0}</td>
      <td>${stepperHtml(`data-ret="${p.id}"`, ds[p.id]?.returned ?? '', p.label)}</td><td class="flag ${s.cls}">${esc(s.text)}</td></tr>`; }).join('') || '<tr><td colspan=6>No stock loaded or sold.</td></tr>'}</table>
    <div class="row"><button class="btn" id="loss">Record a loss</button></div>`;
  const s2 = `<h3>${closed ? 'Cash' : 'Step 2. Count the cash'}</h3>
    <div class="kv"><span>Opening float</span><b>${money(day.float)}</b></div>
    <div class="kv"><span>Cash it should be<small>float + cash sales + cash order payments + cash repaid - cash out and expenses</small></span><b>${money(expected)}</b></div>
    <button class="btn primary" id="calc">Count notes and coins</button>
    <label class="kv"><span>Cash counted</span><input class="num wide" id="counted" inputmode="decimal" value="${day.countedCash == null ? '' : (day.countedCash / 100).toFixed(2)}" placeholder="0.00"></label>
    <div class="kv"><span>Over (+) or short (-)</span><b id="cdiff">${day.countedCash == null ? '-' : money(day.countedCash - expected)}</b></div>
    ${rowsCash.length ? `<table class="t"><tr><th>Note/coin</th><th>Before</th><th>After</th><th>Change</th></tr>${rowsCash.map(r => `<tr><td>${denomLabel(r.denom)}</td><td>${r.before}</td><td>${r.after}</td><td>${r.change > 0 ? '+' : ''}${r.change} (${money(r.value)})</td></tr>`).join('')}</table>` : ''}
    <label class="kv"><span>Float to keep for next market (optional)</span><input class="num wide" id="keep" inputmode="decimal" value="${day.keepFloat == null ? '' : (day.keepFloat / 100).toFixed(2)}" placeholder="0.00"></label>
    ${day.keepFloat != null && day.countedCash != null ? `<div class="kv"><span>Banked (counted - kept)</span><b>${money(day.countedCash - day.keepFloat)}</b></div>` : ''}`;
  const s3 = `<h3>${closed ? 'Card and Transfer / PayID' : 'Step 3. Card and Transfer / PayID'}</h3><p class="muted">Check these against the card terminal and your bank.</p>
    <div class="kv"><span>Card received</span><b>${money(pay.card)}</b></div><div class="kv"><span>Transfer / PayID received</span><b>${money(pay.transfer)}</b></div>
    <p class="muted">Includes payments taken on orders while this day was open.</p>`;
  const s4 = `<h3>${closed ? 'Summary' : 'Step 4. Summary and close'}</h3>
    ${!closed && day.countedCash == null ? '<div class="banner">Cash not counted yet <button class="btn small" id="gocount">Count now</button></div>' : ''}
    ${!closed && issues.length ? `<div class="banner">Needs a look: ${issues.join(', ')}. You can still close the day.</div>` : ''}
    <div class="kv"><span>Sales</span><b>${money(salesTotal)}</b></div>
    ${sum(sales, x => x.rounding || 0) ? `<div class="kv"><span>Cash rounding to 5c (already in the cash total)</span><b>${money(sum(sales, x => x.rounding || 0))}</b></div>` : ''}
    <div class="kv"><span>Expenses (stall fee, fuel, supplies, other)</span><b>${money(expenses)}</b></div>
    <div class="kv"><span>Net (sales - expenses)</span><b>${money(salesTotal - expenses)}</b></div>`;
  const nav = closed ? `<div class="row"><button class="btn ghost" id="back">Back</button><button class="btn" id="reopen">Reopen day</button></div>`
    : `<div class="row"><button class="btn ghost" id="prev">Back</button>${step < 4 ? `<button class="btn primary big" id="next">Next: ${STEPS[step]}</button>` : '<button class="btn primary big" id="close">Close day</button>'}</div>`;
  root.innerHTML = `<div class="card"><h2>${closed ? 'Report' : 'End of day'}: ${esc(lmap[day.location]?.name)}</h2><p>${fmtDate(day.date)} &middot; ${closed ? 'closed' : 'open'}
    ${day.weather ? ' &middot; ' + esc(day.weather) : ''}${day.crowd ? ' &middot; crowd ' + day.crowd + '/5' : ''}</p>
    ${closed ? '' : `<ol class="steps" aria-label="Progress">${STEPS.map((s, i) => `<li class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}" ${i + 1 === step ? 'aria-current="step"' : ''}>${i + 1}. ${s}</li>`).join('')}</ol>`}
    ${show(1) ? s1 : ''}${show(2) ? s2 : ''}${show(3) ? s3 : ''}${show(4) ? s4 : ''}</div>
    ${show(4) ? await notesCard(day) : ''}<div class="card">${nav}</div>`;

  const refresh = () => $$('#rec tr[data-p]', root).forEach(tr => { const s = status(tr.dataset.p, $('input', tr).value), f = $('.flag', tr); f.textContent = s.text; f.className = 'flag ' + s.cls; });
  root.onchange = async e => {
    if (await notesChange(e, day, root)) return;
    const i = e.target;
    if (i.dataset.ret) {
      const p = i.dataset.ret, old = ds[p]?.returned ?? null, n = i.value === '' ? null : Math.max(0, Math.round(+i.value));
      const apply = async v => db.transaction('rw', db.dayStock, db.stock, async () => {
        await adjustStock(p, (v ?? 0) - (ds[p]?.returned ?? 0));
        await db.dayStock.put({ id: day.id + '|' + p, marketDayId: day.id, productId: p, taken: ds[p]?.taken || 0, returned: v });
        ds[p] = { ...(ds[p] || { taken: 0 }), returned: v };
      });
      await apply(n);
      undoToast('Saved', async () => { await apply(old); const inp = $(`input[data-ret="${p}"]`, root); if (inp) inp.value = old ?? ''; refresh(); });
    }
    if (i.id === 'counted') { await saveDay(day, { countedCash: i.value === '' ? null : Math.round(parseFloat(i.value) * 100) }); return render(root); }
    if (i.id === 'keep') {
      const keep = i.value === '' ? null : Math.round(parseFloat(i.value) * 100);
      await saveDay(day, { keepFloat: keep, banked: keep == null || day.countedCash == null ? null : day.countedCash - keep });
      if (keep != null) await db.settings.put({ key: 'nextFloat', value: { amount: keep, counts: breakdown(keep, day.closeCounts) } }); else await db.settings.delete('nextFloat');
      return render(root);
    }
    refresh();
  };
  root.oninput = refresh;
  root.onclick = async e => {
    if (await notesClick(e, day, root)) return;
    if (stepperClick(e)) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'back') return go(root, 'main');
    if (b.id === 'prev') { if (endStep === 1) return go(root, 'main'); endStep--; return render(root); }
    if (b.id === 'gocount') { endStep = 2; window.scrollTo(0, 0); return render(root); }
    if (b.id === 'next') { endStep++; window.scrollTo(0, 0); return render(root); }
    if (b.id === 'loss') { if (await recordLoss(day)) render(root); return; }
    if (b.id === 'calc') {
      const c = await cashCalc('Count the cash at close', day.closeCounts || {}); if (!c) return;
      const t = countTotal(c), keep = day.keepFloat;
      await saveDay(day, { closeCounts: c, countedCash: t, banked: keep == null ? null : t - keep });
      if (keep != null) await db.settings.put({ key: 'nextFloat', value: { amount: keep, counts: breakdown(keep, c) } });
      return render(root);
    }
    if (b.id === 'reopen') {
      if (await openDay()) return toast('Close the open day first');
      await saveDay(day, { status: 'open', closedAt: null }); endStep = 1; return go(root, 'main');
    }
    if (b.id === 'close') {   // no "are you sure": closing is undoable
      await saveDay(day, { status: 'closed', closedAt: Date.now() });
      endStep = 1; go(root, 'main');
      undoToast('Day closed. Remember to back up.', async () => { await saveDay(day, { status: 'open', closedAt: null }); render(root); });
    }
  };
}
