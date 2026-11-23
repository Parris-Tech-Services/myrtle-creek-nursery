// Best-seller and packing insights. Pure functions, no DOM or database.
// A visit: {date, taken:{pid:n}, sold:{pid:n}, revenue:{pid:cents}, lost:{pid:n}, soldOutAt:{pid:minutesSinceMidnight}}

export const minutesOf = ts => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };
export const clock = m => { const h = Math.floor(m / 60) % 24, mm = String(Math.round(m % 60)).padStart(2, '0'); return `${h % 12 || 12}:${mm}${h < 12 ? 'am' : 'pm'}`; };
export const pct = x => (x == null ? '-' : Math.round(x * 100) + '%');

/** Stats per product id. sellThrough = sold / taken, using only visits where something was taken. */
export function productStats(visits) {
  const ids = new Set();
  for (const v of visits) for (const k of ['taken', 'sold', 'lost']) Object.keys(v[k] || {}).forEach(i => ids.add(i));
  const out = {};
  for (const id of ids) {
    const s = { id, visits: 0, takenVisits: 0, taken: 0, sold: 0, soldOnTaken: 0, revenue: 0, lost: 0, soldOut: 0, soldOutMinSum: 0 };
    for (const v of visits) {
      const t = v.taken?.[id] || 0, so = v.sold?.[id] || 0;
      if (t || so) s.visits++;
      s.sold += so; s.revenue += v.revenue?.[id] || 0; s.lost += v.lost?.[id] || 0;
      if (t > 0) { s.taken += t; s.soldOnTaken += so; s.takenVisits++; }
      if (v.soldOutAt?.[id] != null) { s.soldOut++; s.soldOutMinSum += v.soldOutAt[id]; }
    }
    s.avgSold = s.visits ? s.sold / s.visits : 0;
    s.avgRevenue = s.visits ? s.revenue / s.visits : 0;
    s.sellThrough = s.taken > 0 ? s.soldOnTaken / s.taken : null;
    s.avgSoldOutMin = s.soldOut ? s.soldOutMinSum / s.soldOut : null;
    out[id] = s;
  }
  return out;
}

/** Roll products up (e.g. all cherry tomatoes): re-key every visit's numbers, then compute stats as normal. */
export function rollupStats(visits, keyOf) {
  const fold = m => { const o = {}; for (const [id, n] of Object.entries(m || {})) { const k = keyOf(id); o[k] = (o[k] || 0) + n; } return o; };
  return productStats(visits.map(v => ({ ...v, taken: fold(v.taken), sold: fold(v.sold), revenue: fold(v.revenue), lost: fold(v.lost), soldOutAt: {} })));
}

/** Most recent n visits and the n before them, for the trend arrow. */
export function splitPeriods(visits, n = 6) {
  const d = [...visits].sort((a, b) => b.date.localeCompare(a.date));
  return { current: d.slice(0, n), previous: d.slice(n, 2 * n) };
}
/** 'up' | 'down' | 'flat' | null (no earlier period to compare with). */
export function trend(cur, prev) {
  if (!cur || !prev || !prev.visits) return null;
  if (cur.sellThrough != null && prev.sellThrough != null) { const d = cur.sellThrough - prev.sellThrough; return d >= 0.05 ? 'up' : d <= -0.05 ? 'down' : 'flat'; }
  if (!prev.avgSold) return cur.avgSold ? 'up' : 'flat';
  const r = cur.avgSold / prev.avgSold; return r >= 1.1 ? 'up' : r <= 0.9 ? 'down' : 'flat';
}
export const ARROW = { up: '↑ up', down: '↓ down', flat: '→ steady' };

export function rank(rows, by = 'sellThrough') {
  const val = r => (by === 'units' ? r.sold : by === 'revenue' ? r.revenue : r.sellThrough ?? -1);
  return [...rows].sort((a, b) => val(b) - val(a) || b.sold - a.sold);
}

/** here: stats at this market; others: {locationId: stats}. Returns product-id lists with the numbers behind them. */
export function highlights(here, others = {}) {
  const rows = Object.values(here);
  const top = rank(rows.filter(s => s.sellThrough != null), 'sellThrough').slice(0, 5);
  const early = rows.filter(s => s.soldOut >= 1).sort((a, b) => b.soldOut - a.soldOut || a.avgSoldOutMin - b.avgSoldOutMin).slice(0, 5);
  const slow = rows.filter(s => s.sellThrough != null && s.sellThrough < 0.4 && s.takenVisits >= 3).sort((a, b) => a.sellThrough - b.sellThrough);
  const better = [];
  for (const s of rows) {
    if (s.sellThrough == null) continue;
    let best = null;
    for (const [loc, st] of Object.entries(others)) {
      const o = st[s.id];
      if (o && o.sellThrough != null && o.takenVisits >= 2 && o.sellThrough - s.sellThrough >= 0.2 - 1e-9 && (!best || o.sellThrough > best.rate)) best = { loc, rate: o.sellThrough };
    }
    if (best) better.push({ id: s.id, loc: best.loc, here: s.sellThrough, there: best.rate });
  }
  return { top, early, slow, better: better.sort((a, b) => (b.there - b.here) - (a.there - a.here)) };
}

/**
 * Packing suggestion. Uses this market's recent visits; otherwise the average across all markets (`fallback`), then `defaultQty`.
 * A product that has ever sold here keeps a minimum of 2. Returns {qty, demand, shortfall, reason}:
 * demand includes held orders; qty is demand capped by nursery stock; shortfall is how many more the nursery would need.
 */
export function suggestQty({ stats, everSold = 0, fallback = null, lastTaken = 0, lastSold = 0, held = 0, stock = Infinity, defaultQty = 0 }) {
  let demand, reason;
  if (stats?.visits) {
    const n = stats.visits;
    if (stats.soldOut >= 1) {
      demand = Math.max(stats.avgSold, lastTaken) * 1.3;
      reason = `sold out by ${clock(stats.avgSoldOutMin)} ${stats.soldOut === 1 ? 'last visit' : `last ${stats.soldOut} visits`}, bring more`;
    } else if (stats.sellThrough != null && stats.sellThrough < 0.4 && stats.takenVisits >= 3) {
      demand = Math.min(stats.avgSold * 1.1, lastTaken * 0.8);
      reason = `slow here: ${pct(stats.sellThrough)} sold over ${stats.takenVisits} visits, bring fewer`;
    } else {
      demand = Math.max(lastSold, stats.avgSold) * 1.2;
      reason = stats.sellThrough != null ? `${pct(stats.sellThrough)} sold over ${stats.takenVisits} visit${stats.takenVisits === 1 ? '' : 's'}` : `sold ${stats.sold} over ${n} visit${n === 1 ? '' : 's'}`;
    }
  } else if (fallback?.visits) {
    demand = fallback.avgSold * 1.2; reason = `new here: average across markets (${fallback.visits} visit${fallback.visits === 1 ? '' : 's'})`;
  } else { demand = defaultQty; reason = defaultQty ? 'no history yet: starting amount' : 'no history yet'; }
  if (everSold > 0 && demand < 2) { demand = 2; reason += '; keeping a minimum as it has sold here'; }
  const wanted = Math.round(demand) + held;
  return { qty: Math.max(0, Math.min(wanted, stock)), demand: wanted, shortfall: Number.isFinite(stock) ? Math.max(0, wanted - stock) : 0, reason: held ? `${reason}; includes ${held} held` : reason };
}
