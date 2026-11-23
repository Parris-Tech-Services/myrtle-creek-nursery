import { db, catalog, adjustStock, nurseryStock } from './db.js';
import { esc, uid, ymd, fmtDate, groupBy } from './util.js';
import { askForm, undoToast } from './ui.js';
import { reservedByProduct } from './orders.js';
import { recordLoss } from './market.js';

export async function render(root) {
  const { products, types, pmap } = await catalog({ activeOnly: true });
  const stock = await nurseryStock(), held = reservedByProduct(await db.orders.toArray()), g = groupBy(products, p => p.type);
  const batches = (await db.batches.toArray()).sort((a, b) => (a.expectedReady || '').localeCompare(b.expectedReady || ''));
  const remaining = b => b.qtyStarted - (b.losses || 0) - (b.moved || 0);
  const active = batches.filter(b => remaining(b) > 0), done = batches.filter(b => remaining(b) <= 0);
  const row = b => `<div class="kv batch"><span><b>${esc(pmap[b.productId]?.label || '?')}</b> <small>${b.method} ${fmtDate(b.startDate)} &middot; ready ${fmtDate(b.expectedReady) || '?'}</small>
    <small>started ${b.qtyStarted} &middot; lost ${b.losses || 0} &middot; moved ${b.moved || 0} &middot; <b>${remaining(b)} growing</b> ${esc(b.notes)}</small></span>
    <span><button class="btn small" data-loss="${b.id}">Loss</button> <button class="btn small primary" data-ready="${b.id}">Ready</button> <button class="btn small ghost" data-edit="${b.id}">Edit</button></span></div>`;
  root.innerHTML = `<div class="card"><h2>Nursery stock</h2><p class="muted">The number is on hand. Held = reserved for open orders; available = on hand minus held.</p><button class="btn" id="loss">Record loss</button>
    ${types.filter(t => g[t.id]).map(t => `<h3>${esc(t.name)}s</h3>${g[t.id].map(p => `<div class="kv"><span>${esc(p.label)} <small>held ${held[p.id] || 0} &middot; available ${(stock[p.id] || 0) - (held[p.id] || 0)}</small></span>
      <span class="qty"><button data-s="${p.id}" data-d="-1">-</button><button class="n" data-set="${p.id}">${stock[p.id] || 0}</button><button data-s="${p.id}" data-d="1">+</button></span></div>`).join('')}`).join('')}</div>
    <div class="card"><h2>Growing batches</h2><button class="btn primary" id="add">Add batch</button>
    ${active.map(row).join('') || '<p class="muted">No batches growing.</p>'}
    ${done.length ? `<details><summary>Finished (${done.length})</summary>${done.map(row).join('')}</details>` : ''}</div>`;

  const batchForm = (title, b = {}) => askForm(title, [
    { name: 'productId', label: 'Variety', type: 'select', options: products.map(p => [p.id, p.label]) },
    { name: 'method', label: 'Sown or potted', type: 'select', options: [['sown', 'Sown'], ['potted', 'Potted']] },
    { name: 'startDate', label: 'Date', type: 'date' }, { name: 'qtyStarted', label: 'Quantity started', type: 'number' },
    { name: 'expectedReady', label: 'Expected ready', type: 'date' }, { name: 'notes', label: 'Notes' }], b);

  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (b.id === 'loss') { await recordLoss(null); return; }
    if (d.s) { await adjustStock(d.s, +d.d); render(root); return undoToast('Stock changed', async () => { await adjustStock(d.s, -d.d); render(root); }); }
    if (d.set) {
      const v = await askForm('Set stock count', [{ name: 'q', label: pmap[d.set].label, type: 'number' }], { q: stock[d.set] || 0 });
      const delta = v && v.q != null ? Math.round(v.q) - (stock[d.set] || 0) : 0;
      if (delta) { await adjustStock(d.set, delta); undoToast('Stock count set', async () => { await adjustStock(d.set, -delta); render(root); }); }
      return render(root);
    }
    if (b.id === 'add') {
      const v = await batchForm('New batch', { startDate: ymd(), method: 'sown', productId: products[0]?.id });
      if (!v || !(v.qtyStarted > 0)) return;
      await db.batches.add({ id: uid(), ...v, losses: 0, moved: 0 }); return render(root);
    }
    const batch = await db.batches.get(d.loss || d.ready || d.edit);
    if (d.edit) {
      const v = await batchForm('Edit batch', batch); if (!v) return;
      await db.batches.update(batch.id, v); return render(root);
    }
    const rem = batch.qtyStarted - (batch.losses || 0) - (batch.moved || 0);
    if (d.loss) {
      const v = await askForm('Record losses', [{ name: 'n', label: `How many lost (of ${rem} growing)`, type: 'number' }], { n: 1 });
      if (v?.n > 0) await db.batches.update(batch.id, { losses: (batch.losses || 0) + Math.round(v.n) });
    }
    if (d.ready) {
      const v = await askForm('Mark ready for sale', [{ name: 'n', label: 'How many to add to nursery stock', type: 'number' }], { n: rem }, { submit: 'Add to stock' });
      if (v?.n > 0) {
        const n = Math.round(v.n);
        await db.transaction('rw', db.batches, db.stock, async () => { await db.batches.update(batch.id, { moved: (batch.moved || 0) + n }); await adjustStock(batch.productId, n); });
        undoToast(`${n} added to stock`, async () => { await db.transaction('rw', db.batches, db.stock, async () => { await db.batches.update(batch.id, { moved: batch.moved || 0 }); await adjustStock(batch.productId, -n); }); render(root); });
      }
    }
    render(root);
  };
}
