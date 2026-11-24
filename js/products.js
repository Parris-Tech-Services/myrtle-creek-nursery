import { db, catalog, getPeople, setPeople, markets } from './db.js';
import { bestCost } from './pricing.js';
import { esc, money, uid, toCents, dollars, $, $$ } from './util.js';
import { askForm, undoToast, overlay, toast, confirmBox } from './ui.js';

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const NEW = '__new';
let query = '';

/** Save one record right away and offer a 10 second undo. Past sales are never touched: each sale line copies its price when sold. */
async function save(table, rec, label, after) {
  const prev = await db[table].get(rec.id);
  await db[table].put(rec);
  undoToast(label, async () => { prev ? await db[table].put(prev) : await db[table].delete(rec.id); after(); });
  after();
}

export async function render(root) {
  const cat = await catalog();
  const { types, groups, gmap, products, tmap, locations } = cat;
  const people = await getPeople();
  const rerender = () => render(root);
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const price = p => (p.price != null ? money(p.price) : money(gmap[p.group]?.unit || 0));

  const productRows = types.map(t => {
    const ps = products.filter(p => p.type === t.id);
    if (!ps.length) return '';
    const byCat = {}; for (const p of ps) (byCat[p.category || 'No sub-category'] ||= []).push(p);
    return `<h3>${esc(t.name)}${t.hidden ? ' (hidden)' : ''}</h3>${Object.entries(byCat).map(([c, list]) => `<div class="psec"><h4>${esc(c)}</h4>${list.map(p => `
      <div class="kv prow ${p.active ? '' : 'off'}" data-text="${esc((p.label + ' ' + (p.category || '') + ' ' + (gmap[p.group]?.name || '')).toLowerCase())}">
        <button class="rowbtn" data-p="${p.id}">${esc(p.name)}<small>${esc(gmap[p.group]?.name || '')}${p.active ? '' : ' - hidden on Sell'}</small></button>
        <button class="pricebtn" data-price="${p.id}" title="Tap to change price">${price(p)}</button></div>`).join('')}</div>`).join('')}`;
  }).join('');

  root.innerHTML = `<div class="card"><h2>Products and prices</h2>
    <div class="searchbox"><input id="q" type="search" placeholder="Search products" value="${esc(query)}"><div class="row"><button class="btn primary" id="addp">Add product</button></div></div>
    <p class="muted">Tap a name to edit it. Tap a price to change it right here. Past sales keep the price they were sold at.</p>
    <div id="plist">${productRows}</div></div>
  <div class="card"><h2>Pricing groups</h2><p class="muted">Deals apply across every variety in a group.</p>
    ${groups.map(g => `<div class="kv"><span><b>${esc(g.name)}</b><small>${money(g.unit)} each${g.deals?.length ? ', ' + g.deals.map(d => `${d.qty} for ${money(d.price)}`).join(', ') : ', no deals'}${Object.entries(g.locPrices || {}).map(([id, o]) => `<br>${esc(locations.find(l => l.id === id)?.name || id)}: ${money(o.unit)} each${o.deals?.length ? ', ' + o.deals.map(d => `${d.qty} for ${money(d.price)}`).join(', ') : ''}`).join('')}</small></span><button class="btn small" data-g="${g.id}">Edit</button></div>`).join('')}
    <button class="btn" id="addg">Add group</button></div>
  <div class="card"><h2>Sub-categories</h2><p class="muted">Renaming changes every product in it.</p>
    ${cats.map(c => `<div class="kv"><span>${esc(c)}<small>${products.filter(p => p.category === c).length} products</small></span><button class="btn small" data-cat="${esc(c)}">Rename</button></div>`).join('')}</div>
  <div class="card"><h2>Types</h2>${types.map(t => `<div class="kv ${t.hidden ? 'off' : ''}"><span>${esc(t.name)}${t.hidden ? '<small>hidden</small>' : ''}</span><button class="btn small" data-t="${t.id}">Edit</button></div>`).join('')}<button class="btn" id="addt">Add type</button></div>
  <div class="card"><h2>People</h2><p class="muted">Used by "Who was there" on a market day.</p>${people.map((x, i) => `<div class="kv ${x.hidden ? 'off' : ''}"><span>${esc(x.name)}${x.hidden ? '<small>hidden</small>' : ''}</span><button class="btn small" data-person="${i}">Edit</button></div>`).join('')}<button class="btn" id="addperson">Add person</button></div>
  <div class="card"><h2>Locations</h2>${locations.map(l => `<div class="kv ${l.hidden ? 'off' : ''}"><span>${esc(l.name)}${l.hidden ? '<small>hidden</small>' : ''}</span><button class="btn small" data-l="${l.id}">Edit</button></div>`).join('')}<button class="btn" id="addl">Add location</button></div>`;

  // ---- search ----
  const filter = () => {
    query = $('#q', root).value;
    const q = query.trim().toLowerCase();
    $$('.prow', root).forEach(r => { r.hidden = !!q && !r.dataset.text.includes(q); });
    $$('.psec', root).forEach(s => { s.hidden = !$$('.prow', s).some(r => !r.hidden); });
  };
  $('#q', root).oninput = filter; filter();

  // ---- forms ----
  const named = (table, title, item) => async () => {
    const v = await askForm(title, [{ name: 'name', label: 'Name' }, { name: 'hidden', label: 'Hide (keeps history, removes from lists)', type: 'checkbox' }], item || {});
    if (!v?.name) return;
    await save(table, { ...(item || { id: slug(v.name) + '-' + uid().slice(0, 4), sort: 99 }), name: v.name, hidden: !!v.hidden }, `${v.name} saved`, rerender);
  };

  async function groupForm(g) {
    const mk = markets(locations);
    // scope '' = standard price; a market id = that market's own price (only present if it differs)
    const data = { '': { unit: g?.unit || 0, deals: (g?.deals || []).map(d => ({ ...d })) } };
    for (const [id, o] of Object.entries(g?.locPrices || {})) if (mk.some(l => l.id === id)) data[id] = { unit: o.unit, deals: (o.deals || []).map(d => ({ ...d })) };
    let scope = '';
    return new Promise(res => {
      const o = overlay(`<form class="grp"><h3>${g ? 'Edit pricing group' : 'New pricing group'}</h3>
        <label><span>Name</span><input name="name" value="${esc(g?.name || '')}"></label>
        ${mk.length ? '<div class="chipbar" id="scopes" role="toolbar" aria-label="Which price"></div>' : ''}
        <div id="scopebody"></div>
        <div class="row"><button type="button" class="btn ghost" data-a="cancel">Cancel</button><button class="btn primary">Save</button></div></form>`);
      const f = o.querySelector('form');
      const cur = () => data[scope];
      const valid = d => d.deals.filter(x => x.qty > 1 && x.price > 0);
      const example = () => {
        const unit = cur().unit, ds = valid(cur()), max = Math.min(12, Math.max(0, ...ds.map(d => d.qty)) + 2 || 4);
        $('#ex', f).textContent = unit ? Array.from({ length: max }, (_, i) => i + 1).map(n => `${n} = ${money(bestCost(Array(n).fill(unit), ds))}`).join(',  ') : 'Enter a price to see examples.';
      };
      const draw = () => {
        if (mk.length) $('#scopes', f).innerHTML = [['', 'Standard'], ...mk.map(l => [l.id, l.name.split(/\s+[–-]\s+|\s+Markets?$/)[0]])]
          .map(([id, n]) => `<button type="button" class="chip ${scope === id ? 'on' : ''}" data-s="${esc(id)}">${esc(n)}${id && data[id] ? ' •' : ''}</button>`).join('');
        const body = $('#scopebody', f);
        if (scope && !data[scope]) {
          body.innerHTML = `<p class="muted">${esc(locations.find(l => l.id === scope)?.name)} uses the standard price (${money(data[''].unit)} each).</p><button type="button" class="btn" data-a="own">Set a different price here</button>`;
          return;
        }
        const d = cur();
        body.innerHTML = `${scope ? `<p class="muted">Price at ${esc(locations.find(l => l.id === scope)?.name)} only.</p>` : mk.length ? '<p class="muted">Used at every market unless it has its own price (tabs above).</p>' : ''}
          <label><span>Price each</span><input name="unit" inputmode="decimal" value="${d.unit ? dollars(d.unit) : ''}" placeholder="0.00"></label>
          <h4>Multi-buy deals</h4><div id="deals">${d.deals.map((x, i) => `<div class="dealrow"><input type="number" inputmode="numeric" min="2" data-q="${i}" value="${x.qty || ''}" aria-label="Quantity"> for $
          <input inputmode="decimal" data-d="${i}" value="${x.price ? dollars(x.price) : ''}" aria-label="Deal price"><button type="button" class="btn small ghost" data-a="rm" data-i="${i}">Remove</button></div>`).join('') || '<p class="muted">No deals.</p>'}</div>
          <button type="button" class="btn small" data-a="add">Add a deal</button>
          <h4>Example</h4><div class="example" id="ex"></div>
          ${scope ? '<button type="button" class="btn small ghost" data-a="std">Use the standard price here</button>' : ''}`;
        example();
      };
      f.oninput = e => {
        if (e.target.name === 'unit') cur().unit = toCents(e.target.value);
        if (e.target.dataset.q != null) cur().deals[+e.target.dataset.q].qty = Math.round(+e.target.value) || 0;
        if (e.target.dataset.d != null) cur().deals[+e.target.dataset.d].price = toCents(e.target.value);
        if (e.target.name === 'unit' || e.target.dataset.q != null || e.target.dataset.d != null) example();
      };
      f.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.s != null) { scope = b.dataset.s; return draw(); }
        const a = b.dataset.a; if (!a) return;
        if (a === 'add') { cur().deals.push({ qty: 0, price: 0 }); draw(); }
        if (a === 'rm') { cur().deals.splice(+b.dataset.i, 1); draw(); }
        if (a === 'own') { data[scope] = { unit: data[''].unit, deals: data[''].deals.map(d => ({ ...d })) }; draw(); }
        if (a === 'std') { delete data[scope]; draw(); }
        if (a === 'cancel') { o.remove(); res(null); }
      };
      f.onsubmit = e => {
        e.preventDefault();
        if (!f.elements.name.value.trim()) return toast('Enter a name');
        const bad = Object.keys(data).find(k => k && !(data[k].unit > 0));
        if (bad) { scope = bad; draw(); return toast('Enter a price for ' + locations.find(l => l.id === bad)?.name + ', or use the standard price'); }
        const locPrices = Object.fromEntries(Object.entries(data).filter(([k]) => k).map(([k, v]) => [k, { unit: v.unit, deals: valid(v) }]));
        o.remove(); res({ name: f.elements.name.value.trim(), unit: data[''].unit, deals: valid(data['']), locPrices: Object.keys(locPrices).length ? locPrices : undefined });
      };
      draw();
    });
  }

  const categoryFields = (current) => [
    { name: 'category', label: 'Sub-category', type: 'select', options: [...cats.map(c => [c, c]), [NEW, 'New sub-category...']] },
    { name: 'newCategory', label: 'New sub-category name', showWhen: ['category', [NEW]] }];

  async function productForm(p, preset = {}) {
    const used = p ? await usage(p.id) : null;
    const base = p ? { ...p, price: p.price ?? 0 } : { active: true, type: types[0]?.id, group: groups[0]?.id, price: 0, ...preset };
    const v = await askForm(p ? 'Edit product' : 'Add product', [
      { name: 'name', label: 'Name' },
      ...categoryFields(),
      { name: 'type', label: 'Type', type: 'select', options: types.filter(t => !t.hidden || t.id === base.type).map(t => [t.id, t.name]) },
      { name: 'group', label: 'Pricing group', type: 'select', options: groups.map(g => [g.id, g.name]) },
      { name: 'price', label: 'Own price', type: 'money', hint: 'Leave 0 to use the group price.' },
      { name: 'active', label: 'Show on Sell (untick to hide; history is kept)', type: 'checkbox' }],
      base, { extra: p && !used ? [['delete', 'Delete']] : [] });
    if (!v) return;
    if (v._action === 'delete') return removeProduct(p);
    if (!v.name) return;
    const category = v.category === NEW ? v.newCategory.trim() : v.category;
    const { label, ...raw } = p || {};
    await save('products', { ...(p ? raw : { id: slug(category + '-' + v.name) + '-' + uid().slice(0, 4) }), name: v.name, category, type: v.type, group: v.group, price: v.price > 0 ? v.price : null, active: v.active }, `${v.name} saved`, rerender);
  }

  async function usage(id) {
    const checks = [(await db.sales.toArray()).some(s => s.lines.some(l => l.productId === id)), (await db.orders.toArray()).some(o => o.lines.some(l => l.productId === id)),
      (await db.dayStock.toArray()).some(r => r.productId === id), (await db.soldOut.toArray()).some(r => r.productId === id), (await db.losses.where('productId').equals(id).count()) > 0, (await db.batches.where('productId').equals(id).count()) > 0];
    return checks.some(Boolean);
  }
  async function removeProduct(p) {
    if (!await confirmBox(`Delete ${p.name}? It has no sales, so nothing else is affected.`, 'Delete', true)) return;
    const stock = await db.stock.where('productId').equals(p.id).toArray(), pack = (await db.packing.toArray()).filter(x => x.id.endsWith('|' + p.id));
    await db.transaction('rw', db.products, db.stock, db.packing, async () => { await db.products.delete(p.id); await db.stock.bulkDelete(stock.map(s => s.id)); await db.packing.bulkDelete(pack.map(x => x.id)); });
    undoToast(`${p.name} deleted`, async () => { await db.transaction('rw', db.products, db.stock, db.packing, async () => { await db.products.put(p); await db.stock.bulkPut(stock); await db.packing.bulkPut(pack); }); rerender(); });
    rerender();
  }

  async function addProduct() {
    const v = await askForm('Add product: which sub-category?', categoryFields(), { category: cats[0] || NEW }, { submit: 'Next' });
    if (!v) return;
    const category = v.category === NEW ? v.newCategory.trim() : v.category;
    const sib = products.find(p => p.category === category);   // defaults copied from a product already in the sub-category
    return productForm(null, { category: sib ? category : NEW, newCategory: sib ? '' : category, type: sib?.type, group: sib?.group, price: sib?.price || 0 });
  }

  async function renameCategory(old) {
    const v = await askForm('Rename sub-category', [{ name: 'name', label: 'New name' }], { name: old });
    if (!v?.name || v.name === old) return;
    const prev = products.filter(p => p.category === old).map(({ label, ...p }) => p);
    await db.transaction('rw', db.products, async () => { for (const p of prev) await db.products.put({ ...p, category: v.name }); });
    undoToast(`Renamed to ${v.name}`, async () => { await db.transaction('rw', db.products, async () => { for (const p of prev) await db.products.put(p); }); rerender(); });
    rerender();
  }

  async function commitPrice(id, text) {
    const p = products.find(x => x.id === id), cents = toCents(text), next = text.trim() === '' || cents <= 0 ? null : cents;
    if ((p.price ?? null) === next) return rerender();
    const { label, ...raw } = p;
    await save('products', { ...raw, price: next }, `${p.name}: ${next == null ? 'back to group price' : money(next)}`, rerender);
  }

  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.price) {   // inline price edit
      const input = document.createElement('input'); input.className = 'priceinput'; input.inputMode = 'decimal';
      const p = products.find(x => x.id === d.price); input.value = p.price != null ? dollars(p.price) : '';
      input.placeholder = dollars(gmap[p.group]?.unit || 0); input.setAttribute('aria-label', `Price for ${p.name}`);
      b.replaceWith(input); input.focus(); input.select();
      let done = false; const finish = ok => { if (done) return; done = true; ok ? commitPrice(d.price, input.value) : rerender(); };
      input.onkeydown = ev => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); };
      input.onblur = () => finish(true);
      return;
    }
    if (d.p) return productForm(products.find(p => p.id === d.p));
    if (b.id === 'addp') return addProduct();
    if (d.g || b.id === 'addg') {
      const g = d.g ? gmap[d.g] : null, v = await groupForm(g); if (!v) return;
      return save('groups', { ...(g || { id: 'g-' + uid().slice(0, 8), sort: 99 }), ...v }, `${v.name} saved`, rerender);
    }
    if (d.person != null || b.id === 'addperson') {
      const i = d.person != null ? +d.person : -1, cur = people[i];
      const v = await askForm(cur ? 'Edit person' : 'Add person', [{ name: 'name', label: 'Name' }, { name: 'hidden', label: 'Hide (keeps past days)', type: 'checkbox' }], cur || {});
      if (!v?.name) return;
      const before = JSON.stringify(people), days = (await db.marketDays.toArray()).filter(x => cur && (x.staff || []).some(s => s.name === cur.name));
      const next = cur ? people.map((x, k) => (k === i ? { name: v.name, hidden: !!v.hidden } : x)) : [...people, { name: v.name }];
      await setPeople(next);
      if (cur && v.name !== cur.name) for (const day of days) await db.marketDays.put({ ...day, staff: day.staff.map(s => (s.name === cur.name ? { ...s, name: v.name } : s)) });   // renames past days too
      undoToast(`${v.name} saved`, async () => { await setPeople(JSON.parse(before)); for (const day of days) await db.marketDays.put(day); rerender(); });
      return rerender();
    }
    if (d.cat) return renameCategory(d.cat);
    if (d.t || b.id === 'addt') return named('types', d.t ? 'Edit type' : 'New type', d.t ? tmap[d.t] : null)();
    if (d.l || b.id === 'addl') return named('locations', d.l ? 'Edit location' : 'New location', d.l ? cat.lmap[d.l] : null)();
  };
}
