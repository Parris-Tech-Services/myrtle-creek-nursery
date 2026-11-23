import { db, catalog, paymentTotals, owed, dayCash, LOSS_REASONS } from './db.js';
import { salesCsv, ordersCsv, deliverFile } from './sync.js';
import { liability } from './orders.js';
import { totalPersonHours, netPerHour } from './staff.js';
import { esc, money, sum, ymd, fmtDate, lineNets, $ } from './util.js';
import { overlay } from './ui.js';
import { showReport } from './market.js';
import { renderBest } from './bestsellers.js';

let from = '', to = '';
export async function render(root) {
  const { pmap, tmap, lmap } = await catalog();
  const days = (await db.marketDays.toArray()).filter(d => (!from || d.date >= from) && (!to || d.date <= to)).sort((a, b) => b.date.localeCompare(a.date));
  const dmap = Object.fromEntries(days.map(d => [d.id, d]));
  const sales = (await db.sales.toArray()).filter(s => !s.voided && dmap[s.marketDayId]);
  const units = s => sum(s.lines, l => l.qty);

  const orders = await db.orders.toArray();
  const orderPays = orders.flatMap(o => (o.payments || []).map(p => ({ ...p, customer: o.customer }))).filter(p => (!from || p.date >= from) && (!to || p.date <= to));
  const byDay = await Promise.all(days.map(async d => {
    const ss = sales.filter(s => s.marketDayId === d.id), p = paymentTotals(ss, orderPays.filter(x => x.marketDayId === d.id)), t = sum(ss, s => s.total);
    const { expenses } = await dayCash(d, ss);
    return { d, n: ss.length, u: sum(ss, units), t, expenses, net: t - expenses, ...p };
  }));
  const losses = (await db.losses.toArray()).filter(l => (!from || l.date >= from) && (!to || l.date <= to));
  const rmap = Object.fromEntries(LOSS_REASONS), lossAgg = (keyf) => { const m = {}; for (const l of losses) { const a = (m[keyf(l)] ||= { u: 0, t: 0 }); a.u += l.qty; a.t += l.qty * l.unitPrice; } return m; };
  const outs = (await db.soldOut.toArray()).filter(r => dmap[r.marketDayId]).sort((a, b) => a.ts - b.ts);
  const hhmm = ts => new Date(ts).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  const locAgg = {};
  for (const r of byDay) { const a = (locAgg[r.d.location] ||= { days: 0, n: 0, u: 0, t: 0 }); a.days++; a.n += r.n; a.u += r.u; a.t += r.t; }
  const typeAgg = {}, catAgg = {}, varAgg = {};
  const add = (m, k, l, net) => { const a = (m[k] ||= { u: 0, t: 0 }); a.u += l.qty; a.t += net; };
  for (const s of sales) {
    const nets = lineNets(s, pmap);
    s.lines.forEach((l, i) => {
      const p = pmap[l.productId] || {};
      add(typeAgg, tmap[p.type]?.name || 'Other', l, nets[i]);
      add(catAgg, `${tmap[p.type]?.name || 'Other'} / ${p.category || '-'}`, l, nets[i]);
      add(varAgg, p.label || l.name || l.productId, l, nets[i]);
    });
  }
  const tbl = (head, rows) => `<div class="scroll"><table class="t"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || '<tr><td colspan=9>No sales.</td></tr>'}</table></div>`;
  const agg = m => Object.entries(m).sort((a, b) => b[1].t - a[1].t).map(([k, a]) => [esc(k), a.u, money(a.t)]);
  const o = await owed();

  root.innerHTML = `<div class="card"><h2>Reports</h2>
    <div class="row"><label class="kv"><span>From</span><input type="date" id="from" value="${from}"></label><label class="kv"><span>To</span><input type="date" id="to" value="${to}"></label></div>
    <div class="kv"><span>Total sales</span><b>${money(sum(sales, s => s.total))}</b></div>
    <div class="kv"><span>Deals saved customers</span><b>${money(sum(sales, s => s.dealSavings))}</b></div>
    <div class="kv"><span>Owed to the business</span><b>${money(o.total)}</b></div>
    <div class="kv"><span>Prepaid orders not yet collected</span><b>${money(liability(orders))}</b></div>
    <div class="kv"><span>Expenses (all days) / net</span><b>${money(sum(byDay, r => r.expenses))} / ${money(sum(byDay, r => r.net))}</b></div>
    <div class="kv"><span>Losses (value)</span><b>${money(sum(losses, l => l.qty * l.unitPrice))}</b></div>
    <div class="row"><button class="btn primary" id="csv">Export sales lines (CSV)</button><button class="btn" id="ocsv">Export orders (CSV)</button></div></div>
  <div id="best"></div>
  <div class="card"><h3>By market day</h3><p class="muted">Sales value counts orders on the day they were collected. Cash, card and Transfer / PayID are money received that day (including order payments). Net = sales - expenses (stall fee, fuel, supplies, other).</p>${tbl(['Date', 'Location', 'Weather', 'Crowd', 'Sales', 'Units', 'Sales $', 'Expenses', 'Net', 'Cash', 'Card', 'Transfer / PayID', ''],
    byDay.map(r => [fmtDate(r.d.date), esc(lmap[r.d.location]?.name), esc(r.d.weather || ''), r.d.crowd || '', r.n, r.u, money(r.t), money(r.expenses), money(r.net), money(r.cash), money(r.card), money(r.transfer),
      `<button class="btn small" data-h="${r.d.id}">Hours</button> <button class="btn small" data-r="${r.d.id}">Open</button>`]))}
    ${byDay.filter(r => r.d.notes).map(r => `<p class="muted"><b>${fmtDate(r.d.date)}:</b> ${esc(r.d.notes)}</p>`).join('')}
    ${byDay.filter(r => totalPersonHours(r.d) > 0).map(r => `<p class="muted">${fmtDate(r.d.date)}: Person-hours: ${+totalPersonHours(r.d).toFixed(2)} &middot; Net per person-hour: ${money(netPerHour(r.net, r.d))}</p>`).join('')}</div>
  <div class="card"><h3>By location</h3>${tbl(['Location', 'Days', 'Sales', 'Units', 'Total'], Object.entries(locAgg).map(([k, a]) => [esc(lmap[k]?.name), a.days, a.n, a.u, money(a.t)]))}</div>
  <div class="card"><h3>By type</h3>${tbl(['Type', 'Units', '$'], agg(typeAgg))}<h3>By sub-category</h3>${tbl(['Category', 'Units', '$'], agg(catAgg))}</div>
  <div class="card"><h3>Losses by reason</h3>${tbl(['Reason', 'Units', 'Value'], Object.entries(lossAgg(l => rmap[l.reason] || l.reason)).map(([k, a]) => [esc(k), a.u, money(a.t)]))}
    <h3>Losses by location</h3>${tbl(['Location', 'Units', 'Value'], Object.entries(lossAgg(l => lmap[l.locationId]?.name || '?')).map(([k, a]) => [esc(k), a.u, money(a.t)]))}</div>
  <div class="card"><h3>Sold-out log</h3>${tbl(['Date', 'Location', 'Product', 'Sold out at'], outs.map(r => [fmtDate(dmap[r.marketDayId].date), esc(lmap[dmap[r.marketDayId].location]?.name), esc(pmap[r.productId]?.label), hhmm(r.ts)]))}</div>
  <div class="card"><h3>Order payments received</h3>${tbl(['Date', 'Customer', 'Method', 'Amount'], orderPays.sort((a, b) => b.date.localeCompare(a.date)).map(p => [fmtDate(p.date), esc(p.customer), p.method, money(p.amount)]))}</div>
  <div class="card"><h3>By variety</h3>${tbl(['Variety', 'Units', '$ (net of deals)'], agg(varAgg))}</div>`;
  renderBest($('#best', root));
  root.onchange = e => { if (e.target.closest('#best')) return; if (e.target.id === 'from') from = e.target.value; if (e.target.id === 'to') to = e.target.value; render(root); };
  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.r) return showReport(b.dataset.r);
    if (b.dataset.h) {
      const hrs = {}; for (const s of sales.filter(s => s.marketDayId === b.dataset.h)) { const h = new Date(s.timestamp).getHours(), a = (hrs[h] ||= { n: 0, u: 0, t: 0 }); a.n++; a.u += units(s); a.t += s.total; }
      overlay(`<h3>Sales by hour</h3>${tbl(['Hour', 'Sales', 'Units', '$'], Object.entries(hrs).map(([h, a]) => [`${h}:00`, a.n, a.u, money(a.t)]))}<button class="btn ghost" onclick="this.closest('.overlay').remove()">Close</button>`);
      return;
    }
    if (b.id === 'ocsv') return void await deliverFile(new Blob([await ordersCsv()], { type: 'text/csv' }), `myrtle-creek-orders-${ymd()}.csv`);
    if (b.id === 'csv') { await deliverFile(new Blob([await salesCsv(from, to)], { type: 'text/csv' }), `myrtle-creek-sales-${ymd()}.csv`); }
  };
}
