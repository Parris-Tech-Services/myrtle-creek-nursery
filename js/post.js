// Facebook / Marketplace post text. Pure and template-based (no AI, no network). Plain text only: Facebook does not render markdown.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BROAD = 'Greens & herbs';   // catch-all sub-category: list its items on their own, not under a heading

export const dateLabel = ymd => { const d = new Date(ymd + 'T12:00:00Z'); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const priceLabel = c => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
export const priceLine = g => `${priceLabel(g.unit)} each` + (g.deals || []).map(d => ` or ${d.qty} for ${priceLabel(d.price)}`).join('');
const plural = n => (/s$/i.test(n) ? n : n + 's');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const catHeading = c => (/tomato$/i.test(c) ? c.replace(/tomato$/i, m => m + 'es') : c).toUpperCase();
const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const list = a => [...a].sort(byName);
/** "Basil (Purple)", not just "Purple": a bare variety name means little in a post. */
const fullName = p => (p.category && p.category !== BROAD && p.category !== p.name ? `${p.category} (${p.name})` : p.name);

export const DEFAULTS = { emoji: true, limited: true, limit: 6, fresh: true, pickup: false, pickupText: '', hold: false, signoff: '' };

/**
 * going:   [{id, name, category, group, price|null}]   products being taken
 * qty:     {id: number}
 * groups:  {groupId: {name, unit, deals:[{qty, price}]}}   (in display order via groupOrder)
 * prevIds: ids taken to the previous visit (omit or empty to skip "NEW")
 */
export function buildPost({ market, date, time = '', going, qty = {}, groups, groupOrder = Object.keys(groups), prevIds = null, options = {} }) {
  const o = { ...DEFAULTS, ...options }, e = (sym) => (o.emoji ? sym + ' ' : '');
  const own = p => p.price != null;   // has its own price (trees): listed with that price, not under the group price
  const L = [`${e('🍅')}Myrtle Creek Nursery at ${market} – ${dateLabel(date)}${time ? ', ' + time : ''}`, ''];

  const present = groupOrder.filter(g => going.some(p => p.group === g));
  const priceRows = [];
  for (const g of present) {
    const grp = groups[g], shared = going.filter(p => p.group === g && !own(p));
    if (shared.length && grp.unit > 0) priceRows.push(`${plural(grp.name)}: ${priceLine(grp)}`);
  }
  const ownRows = going.filter(own);
  if (priceRows.length || ownRows.length) {
    L.push(`${e('🏷️')}PRICES`, ...priceRows);
    for (const g of present) {
      const items = list(going.filter(p => p.group === g && own(p)).map(p => `${p.name} ${priceLabel(p.price)}`));
      if (items.length) L.push(`${plural(groups[g].name)}: ${items.join(' · ')}`);
    }
    L.push('');
  }

  for (const g of present) {
    const items = going.filter(p => p.group === g && !own(p));
    if (!items.length) continue;
    const cats = {};
    for (const p of items) (cats[p.category || BROAD] ||= []).push(p.name);
    const names = Object.keys(cats), compact = names.includes(BROAD) || names.length > 8;
    if (!compact) {
      // one line per category; small categories (1-2 varieties) share a line
      const big = names.filter(c => cats[c].length > 2).sort(byName), small = names.filter(c => cats[c].length <= 2).sort(byName);
      for (const c of big) L.push(`${catHeading(c)}: ${list(cats[c]).join(', ')}`);
      if (small.length) L.push(small.map(c => `${catHeading(c)}: ${list(cats[c]).join(', ')}`).join(' | '));
    } else {
      L.push(plural(groups[g].name).toUpperCase());
      const parts = [];
      for (const c of names) {
        if (c === BROAD) parts.push(...cats[c].map(n => ({ k: n, t: n })));
        else if (cats[c].length === 1) parts.push({ k: c, t: `${c} (${cats[c][0]})` });
        else parts.push({ k: c, t: `${c} (${list(cats[c]).join(', ')})` });
      }
      L.push(parts.sort((a, b) => byName(a.k, b.k)).map(x => x.t).join(' · '));
    }
    L.push('');
  }

  if (o.limited) {
    const few = going.filter(p => (qty[p.id] ?? Infinity) > 0 && (qty[p.id] ?? Infinity) <= o.limit).map(fullName);
    if (few.length) L.push(`${e('⏳')}Limited numbers: ${list(few).join(', ')}`);
  }
  if (o.fresh && prevIds && prevIds.size) {
    const fresh = going.filter(p => !prevIds.has(p.id)).map(fullName);
    if (fresh.length) L.push(`${e('🌱')}NEW this week: ${list(fresh).join(', ')}`);
  }
  // Order at the bottom: sign-off, then the pickup note, then "hold plants" as the very last line.
  if (o.signoff.trim()) L.push('', o.signoff.trim());
  if (o.pickup && o.pickupText.trim()) L.push('', o.pickupText.trim());
  if (o.hold) L.push('Message us to hold plants.');

  const full = L.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Short version for a Marketplace title and description
  const cheap = present.filter(g => going.some(p => p.group === g && !own(p)) && groups[g].unit > 0).map(g => `${plural(groups[g].name).toLowerCase()} ${priceLabel(groups[g].unit)}${groups[g].deals?.length ? ` (${groups[g].deals.map(d => `${d.qty} for ${priceLabel(d.price)}`).join(', ')})` : ''}`);
  if (ownRows.length) cheap.push(`trees from ${priceLabel(Math.min(...ownRows.map(p => p.price)))}`);
  const cats = [...new Set(going.filter(p => !own(p) && p.category && p.category !== BROAD).map(p => p.category))].sort(byName);
  const shown = cats.slice(0, 8).map(c => c.toLowerCase());
  const short = [`${e('🍅')}Myrtle Creek Nursery at ${market} – ${dateLabel(date)}${time ? ', ' + time : ''}`,
    cheap.length ? cap(cheap.join(', ')) + '.' : '',
    shown.length ? `${cap(shown.join(', '))}${cats.length > 8 ? ' and more' : ''}, plus vegetable and herb punnets.` : ''].filter(Boolean).join('\n');
  return { full, short };
}
