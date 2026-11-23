// AUD cash counting helpers. Pure functions. Money in cents; counts are {denomCents: howMany}.
export const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];
export const denomLabel = c => (c >= 100 ? '$' + c / 100 : c + 'c');
export const countTotal = counts => DENOMS.reduce((t, d) => t + d * (counts?.[d] || 0), 0);

/** Make up `amount` from notes and coins. With `available` counts it uses those first (largest first), then tops up freely. */
export function breakdown(amount, available = null) {
  const out = {}; let rest = amount;
  const pass = limit => {
    for (const d of DENOMS) {
      let n = Math.floor(rest / d);
      if (limit) n = Math.min(n, (limit[d] || 0) - (out[d] || 0));
      if (n > 0) { out[d] = (out[d] || 0) + n; rest -= n * d; }
    }
  };
  if (available) pass(available);
  pass(null);
  return out;
}

/** Rows for a before/after table: only denominations that were counted at either end. */
export const diffCounts = (before, after) => { before ||= {}; after ||= {}; return DENOMS.filter(d => before[d] || after[d])
  .map(d => ({ denom: d, before: before[d] || 0, after: after[d] || 0, change: (after[d] || 0) - (before[d] || 0), value: ((after[d] || 0) - (before[d] || 0)) * d })); };

// ---- change calculator -------------------------------------------------------
/** Australian cash rounding: the CASH amount goes to the nearest 5c (1-2c down, 3-4c up). Card and transfer are never rounded. */
export const roundCash5 = c => Math.round(c / 5) * 5;

/**
 * Settle the cash part of a sale. cashPortion is the exact amount to be paid in cash; tendered is what the customer
 * handed over (null = exact, the fast path). rounding = rounded due - exact portion (can be negative).
 * Net cash kept = tendered - change = due, so expected float cash grows by `due` (= portion + rounding), never more.
 */
export function settleCash(cashPortion, tendered = null) {
  const due = roundCash5(cashPortion), rounding = due - cashPortion;
  if (tendered == null) return { due, rounding, tendered: due, change: 0, short: 0 };
  return { due, rounding, tendered, change: Math.max(0, tendered - due), short: Math.max(0, due - tendered) };
}

/** "1 x $20, 1 x $1" (largest first) */
export const describeBreakdown = counts => DENOMS.filter(d => counts[d]).map(d => `${counts[d]} × ${denomLabel(d)}`).join(', ');

/** Round-up amounts above `due` (cents) to offer as quick buttons: next $5, $10, $20, $50, $100 multiples, at most 4. */
export function quickAmounts(due) {
  if (due <= 0) return [];
  const ups = [5, 10, 20, 50, 100].map(n => Math.ceil(due / (n * 100)) * n * 100).filter(a => a > due);
  return [...new Set(ups)].sort((a, b) => a - b).slice(0, 4);
}
export const NOTE_BUTTONS = [500, 1000, 2000, 5000, 10000];

/**
 * A change-friendly float for the next market: mostly $20s and $10s, then $5s, then coins; never $50 or $100 notes.
 * $100 comes out as 2 x $20, 4 x $10, 2 x $5 and coins. Uses what was counted (`available`) first, then tops up freely.
 */
const SHARE = [[2000, 0.40], [1000, 0.40], [500, 0.10], [200, 0.05], [100, 0.03], [50, 0.01], [20, 0.005], [10, 0.003], [5, 0.002]];
export function floatMix(amount, available = null) {
  const out = {}; let rest = amount;
  for (const [d, share] of SHARE) {
    let n = Math.floor(amount * share / d);
    if (available) n = Math.min(n, available[d] || 0);
    n = Math.min(n, Math.floor(rest / d));
    if (n > 0) { out[d] = n; rest -= n * d; }
  }
  for (const limit of [available, null]) {
    for (const d of SHARE.map(x => x[0])) {
      let n = Math.floor(rest / d);
      if (limit) n = Math.min(n, (limit[d] || 0) - (out[d] || 0));
      if (n > 0) { out[d] = (out[d] || 0) + n; rest -= n * d; }
    }
  }
  return out;
}
