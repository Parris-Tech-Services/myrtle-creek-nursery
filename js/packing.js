import { db, catalog, markets, packingPlan, openDay } from './db.js';
import { esc, groupBy, ymd, clampQty, $ } from './util.js';
import { showPostDialog } from './postview.js';
import { clock } from './insights.js';

let loc = null;
export async function render(root) {
  const { locations, types } = await catalog();
  const m = markets(locations);
  loc = loc || (await openDay())?.location || m[0]?.id;
  const plan = await packingPlan(loc), g = groupBy(plan, r => r.product.type);
  root.innerHTML = `<div class="card"><h2>Packing list</h2><button class="btn primary" id="post">Make a post</button><button class="btn" id="takeall">Take all nursery stock</button>
    <label class="kv"><span>Location</span><select id="loc">${m.map(l => `<option value="${l.id}" ${l.id === loc ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
    <p class="muted">Based on ${plan[0]?.visits || 0} closed visit(s). Suggested quantities come from this market's last 3 visits (% sold and sold-out times), plus held orders, capped by nursery stock; the grey line says why. Type in the Pack column to change today's quantity only; clear it to go back to the suggestion. This feeds Load stock.</p>
    <table class="t"><tr><th>Product</th><th>Last taken</th><th>Last sold</th><th>Avg sold (3)</th><th>Held orders</th><th>Sold out</th><th>Nursery</th><th>Pack</th></tr>
    ${types.filter(t => g[t.id]).map(t => `<tr class="grp"><td colspan=8>${esc(t.name)}s</td></tr>${g[t.id].map(r => `<tr><td>${esc(r.product.label)}${r.reason ? `<small>${esc(r.reason)}</small>` : ''}${r.shortfall > 0 ? `<small class="warn-text">Demand ~${r.demand}, nursery has ${r.nursery}: grow ${r.shortfall} more</small>` : ''}</td><td>${r.lastTaken}</td><td>${r.lastSold}</td>
      <td>${r.avg.toFixed(1)}</td><td>${r.held || ''}</td><td>${r.soldOut != null ? clock(r.soldOut) : ''}</td><td>${r.nursery}</td><td><input class="num" type="number" inputmode="numeric" min="0" data-p="${r.product.id}" placeholder="${r.suggested}" value="${r.edited ?? ''}"></td></tr>`).join('')}`).join('')}</table></div>`;
  $('#post', root).onclick = () => showPostDialog(loc);
  $('#takeall', root).onclick = async () => {   // today's quantities: everything the nursery has
    const today = ymd();
    await db.packing.bulkPut(plan.filter(r => r.nursery > 0).map(r => ({ id: loc + '|' + r.product.id, qty: clampQty(r.nursery), date: today })));
    render(root);
  };
  $('#loc', root).onchange = e => { loc = e.target.value; render(root); };
  root.onchange = async e => {
    const p = e.target.dataset.p; if (!p) return;
    const id = loc + '|' + p;
    e.target.value === '' ? await db.packing.delete(id) : await db.packing.put({ id, qty: clampQty(e.target.value), date: ymd() });   // applies to this market day only
  };
}
