import { db, catalog, packingPlan, nurseryStock, getSetting, setSetting, markets } from './db.js';
import { reservedByProduct } from './orders.js';
import { buildPost, DEFAULTS } from './post.js';
import { overlay, toast } from './ui.js';
import { esc, ymd } from './util.js';

/** What is going: packing-list quantities above zero, or nursery stock not held for orders if no packing list exists. */
async function goingFor(locId) {
  const plan = await packingPlan(locId);
  let rows = plan.filter(r => r.qty > 0).map(r => ({ p: r.product, q: r.qty }));
  if (!rows.length) {
    const stock = await nurseryStock(), held = reservedByProduct(await db.orders.toArray());
    rows = plan.map(r => ({ p: r.product, q: (stock[r.product.id] || 0) - (held[r.product.id] || 0) })).filter(x => x.q > 0);
  }
  const visit = (await db.marketDays.where('location').equals(locId).toArray()).filter(d => d.status === 'closed').sort((a, b) => b.date.localeCompare(a.date))[0];
  const prevIds = visit ? new Set((await db.dayStock.where('marketDayId').equals(visit.id).toArray()).filter(r => r.taken > 0).map(r => r.productId)) : null;
  return { going: rows.map(x => x.p), qty: Object.fromEntries(rows.map(x => [x.p.id, x.q])), prevIds };
}

export async function showPostDialog(locId = null) {
  const { locations, groups, lmap } = await catalog();
  const m = markets(locations);
  locId ||= m[0]?.id;
  const saved = await getSetting('postOpts', {});
  const o = { ...DEFAULTS, ...saved };
  const gmap = Object.fromEntries(groups.map(g => [g.id, g]));
  const ov = overlay(`<form class="post"><h3>Make a post</h3>
    <label><span>Market</span><select name="loc">${m.map(l => `<option value="${l.id}" ${l.id === locId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
    <div class="row"><label><span>Date</span><input type="date" name="date" value="${ymd()}"></label><label><span>Time (optional)</span><input name="time" placeholder="8am to 1pm"></label></div>
    <label class="chk"><input type="checkbox" name="emoji" ${o.emoji ? 'checked' : ''}><span>Emojis</span></label>
    <label class="chk"><input type="checkbox" name="limited" ${o.limited ? 'checked' : ''}><span>Show "limited numbers" (6 or fewer)</span></label>
    <label class="chk"><input type="checkbox" name="fresh" ${o.fresh ? 'checked' : ''}><span>Show "new this week"</span></label>
    <label class="chk"><input type="checkbox" name="pickup" ${o.pickup ? 'checked' : ''}><span>Include a pickup / delivery note</span></label>
    <label class="chk"><input type="checkbox" name="hold" ${o.hold ? 'checked' : ''}><span>Add "Message us to hold plants."</span></label>
    <label data-pickup-note ${o.pickup ? '' : 'hidden'}><span>Pickup note (your own words)</span><input name="pickupText" value="${esc(o.pickupText)}"></label>
    <label><span>Sign-off (optional)</span><input name="signoff" value="${esc(o.signoff)}"></label>
    <h4>Post</h4><textarea name="full" rows="12"></textarea>
    <h4>Short version (Marketplace)</h4><textarea name="short" rows="4"></textarea>
    <div class="row"><button type="button" class="btn primary" data-a="copy-full">Copy post</button><button type="button" class="btn" data-a="copy-short">Copy short</button><button type="button" class="btn" data-a="share">Share</button><button type="button" class="btn ghost" data-a="close">Close</button></div></form>`);
  const f = ov.querySelector('form');
  let cache = null, cacheLoc = null;
  const regen = async () => {
    const e = f.elements, loc = e.loc.value;
    f.querySelector('[data-pickup-note]').hidden = !e.pickup.checked;
    if (cacheLoc !== loc) { cache = await goingFor(loc); cacheLoc = loc; }
    const options = { emoji: e.emoji.checked, limited: e.limited.checked, fresh: e.fresh.checked, pickup: e.pickup.checked, pickupText: e.pickupText.value, hold: e.hold.checked, signoff: e.signoff.value };
    await setSetting('postOpts', options);
    const out = cache.going.length
      ? buildPost({ market: lmap[loc].name, date: e.date.value, time: e.time.value.trim(), going: cache.going, qty: cache.qty, groups: gmap, groupOrder: groups.map(g => g.id), prevIds: cache.prevIds, options })
      : { full: 'Nothing to post yet: no packing list quantities and no nursery stock.', short: '' };
    e.full.value = out.full; e.short.value = out.short;
  };
  f.onchange = f.oninput = regen;
  // Copy synchronously inside the tap (works where the async clipboard API stalls), always confirm on screen.
  // The toast and the button label change at the moment of the tap, whatever the clipboard does afterwards.
  const copy = (el, btn) => {
    let ok = false;
    try { el.focus(); el.select(); el.setSelectionRange(0, el.value.length); ok = document.execCommand('copy'); } catch { ok = false; }
    const was = btn.textContent;
    toast(ok ? 'Copied' : 'Select the text and copy it', 3000);
    btn.textContent = ok ? 'Copied \u2713' : was; setTimeout(() => { btn.textContent = was; }, 2000);
    if (!ok) navigator.clipboard?.writeText(el.value).then(() => { toast('Copied', 3000); btn.textContent = 'Copied \u2713'; setTimeout(() => { btn.textContent = was; }, 2000); }).catch(() => {});
  };
  f.onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'close') ov.remove();
    if (a === 'copy-full') copy(f.elements.full, e.target);
    if (a === 'copy-short') copy(f.elements.short, e.target);
    if (a === 'share') { if (navigator.share) { try { await navigator.share({ text: f.elements.full.value }); } catch { /* cancelled */ } } else copy(f.elements.full, e.target); }
  };
  regen();
}
