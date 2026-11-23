import { catalog, loadVisits, markets } from './db.js';
import { productStats, rollupStats, splitPeriods, trend, rank, highlights, ARROW, clock, pct } from './insights.js';
import { esc, money } from './util.js';

const st = { loc: null, n: 6, by: 'sellThrough', view: 'product' };
const bar = x => (x == null ? '-' : `<span class="bar"><i style="width:${Math.min(100, Math.round(x * 100))}%"></i></span> ${pct(x)}`);

export async function renderBest(el) {
  const { locations, pmap, lmap } = await catalog();
  const m = markets(locations), all = await loadVisits(null);
  st.loc ??= m.find(l => all.some(v => v.location === l.id))?.id || m[0]?.id;
  const n = st.n || 999, nm = id => pmap[id]?.label || id;
  const opts = [['', 'All markets (compare)'], ...m.map(l => [l.id, l.name])];

  const controls = `<div class="row"><label><span>Market</span><select id="b-loc">${opts.map(([k, l]) => `<option value="${k}" ${k === (st.loc ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label><span>Visits</span><select id="b-n">${[[3, 'Last 3'], [6, 'Last 6'], [10, 'Last 10'], [0, 'All']].map(([k, l]) => `<option value="${k}" ${k === st.n ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label><span>Rank by</span><select id="b-by">${[['sellThrough', '% sold'], ['units', 'Units sold'], ['revenue', 'Revenue $']].map(([k, l]) => `<option value="${k}" ${k === st.by ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label><span>Show</span><select id="b-view"><option value="product" ${st.view === 'product' ? 'selected' : ''}>Products</option><option value="category" ${st.view === 'category' ? 'selected' : ''}>Sub-categories</option></select></label></div>`;
  const head = `<h2>Best sellers</h2><p class="muted">% sold = sold divided by taken, so it is fair to products you bring fewer of. Based on closed market days.</p>${controls}`;
  const table = (cols, rows) => `<div class="scroll"><table class="t"><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}">No closed market days yet.</td></tr>`}</table></div>`;

  if (!st.loc) {   // all markets comparison
    const per = Object.fromEntries(m.map(l => [l.id, productStats(all.filter(v => v.location === l.id).slice(0, n))]));
    const ids = [...new Set(Object.values(per).flatMap(s => Object.keys(s)))];
    const rows = ids.map(id => {
      const rates = m.map(l => per[l.id][id]?.sellThrough ?? null), best = Math.max(...rates.map(r => r ?? -1));
      return { id, rates, best, units: m.reduce((t, l) => t + (per[l.id][id]?.sold || 0), 0), rev: m.reduce((t, l) => t + (per[l.id][id]?.revenue || 0), 0) };
    }).sort((a, b) => (st.by === 'units' ? b.units - a.units : st.by === 'revenue' ? b.rev - a.rev : b.best - a.best));
    el.innerHTML = `<div class="card">${head}${table(['Product', ...m.map(l => esc(l.name)), 'Units', '$'], rows.map(r => [esc(nm(r.id)),
      ...r.rates.map(x => (x == null ? '-' : x === r.best && r.best >= 0 ? `<b>${pct(x)} (best)</b>` : pct(x))), r.units, money(r.rev)]))}</div>`;
    return wire(el);
  }

  const here = all.filter(v => v.location === st.loc), { current, previous } = splitPeriods(here, n);
  const cur = st.view === 'category' ? rollupStats(current, id => pmap[id]?.category || 'Other') : productStats(current);
  const prev = st.view === 'category' ? rollupStats(previous, id => pmap[id]?.category || 'Other') : productStats(previous);
  const rows = rank(Object.values(cur), st.by).map(s => [esc(st.view === 'category' ? s.id : nm(s.id)), s.sold, money(s.revenue), s.avgSold.toFixed(1), bar(s.sellThrough),
    st.view === 'category' ? '-' : s.soldOut ? `${s.soldOut}x, avg ${clock(s.avgSoldOutMin)}` : '', s.lost || '', ARROW[trend(s, prev[s.id])] || '-']);

  const others = Object.fromEntries(m.filter(l => l.id !== st.loc).map(l => [l.id, productStats(all.filter(v => v.location === l.id).slice(0, n))]));
  const h = highlights(productStats(current), others);
  const li = (a, f) => a.length ? `<ul>${a.map(f).join('')}</ul>` : '<p class="muted">Nothing yet.</p>';
  el.innerHTML = `<div class="card">${head}<p><b>${esc(lmap[st.loc]?.name)}</b>: ${current.length} visit${current.length === 1 ? '' : 's'} counted.</p>
    <div class="row hl"><div><h3>Top 5 here</h3>${li(h.top, s => `<li>${esc(nm(s.id))} <small>${pct(s.sellThrough)} sold</small></li>`)}</div>
    <div><h3>Sells out early here, bring more</h3>${li(h.early, s => `<li>${esc(nm(s.id))} <small>out by ${clock(s.avgSoldOutMin)}, ${s.soldOut} visit${s.soldOut === 1 ? '' : 's'}</small></li>`)}</div>
    <div><h3>Slow here, bring fewer</h3>${li(h.slow, s => `<li>${esc(nm(s.id))} <small>${pct(s.sellThrough)} over ${s.takenVisits} visits</small></li>`)}</div>
    <div><h3>Does better elsewhere</h3>${li(h.better, b => `<li>${esc(nm(b.id))} <small>${pct(b.here)} here, ${pct(b.there)} at ${esc(lmap[b.loc]?.name)}</small></li>`)}</div></div>
    ${table([st.view === 'category' ? 'Sub-category' : 'Product', 'Sold', '$', 'Avg / visit', '% sold', 'Sold out', 'Lost', 'Trend'], rows)}</div>`;
  wire(el);
}

function wire(el) {
  el.onchange = e => {
    if (e.target.id === 'b-loc') st.loc = e.target.value; if (e.target.id === 'b-n') st.n = +e.target.value;
    if (e.target.id === 'b-by') st.by = e.target.value; if (e.target.id === 'b-view') st.view = e.target.value;
    renderBest(el);
  };
}
