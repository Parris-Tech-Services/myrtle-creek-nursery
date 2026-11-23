// Deal pricing. Pure functions, no DOM. All money is integer cents.

/**
 * Cheapest total for a list of unit prices given multi-buy deals.
 * deals: [{qty, price}] meaning "qty items for price (cents)".
 * Dynamic programming over units sorted dearest-first, so deals soak up the
 * dearest units. Any units not covered by a deal are charged at their own price.
 */
export function bestCost(unitPrices, deals = []) {
  const p = [...unitPrices].sort((a, b) => b - a);
  const cost = [0];
  for (let i = 1; i <= p.length; i++) {
    cost[i] = cost[i - 1] + p[i - 1];
    for (const d of deals) {
      if (d.qty > 0 && d.qty <= i) cost[i] = Math.min(cost[i], cost[i - d.qty] + d.price);
    }
  }
  return cost[p.length];
}

/**
 * lines: [{group, qty, unitPrice, lineType: 'normal'|'seconds'|'discount'}]
 * dealsByGroup: {groupId: [{qty, price}]}
 * Only 'normal' lines join deals; deals pool all varieties within a pricing group.
 * Returns {regular, total, dealSavings, savingsByGroup}.
 */
export function priceBasket(lines, dealsByGroup = {}) {
  let regular = 0, other = 0;
  const units = {}; // group -> array of unit prices
  for (const l of lines) {
    const qty = Math.max(0, l.qty | 0);
    regular += qty * l.unitPrice;
    if ((l.lineType || 'normal') !== 'normal') { other += qty * l.unitPrice; continue; }
    const arr = (units[l.group] ||= []);
    for (let i = 0; i < qty; i++) arr.push(l.unitPrice);
  }
  let dealt = 0;
  const savingsByGroup = {};
  for (const [group, arr] of Object.entries(units)) {
    const full = arr.reduce((a, b) => a + b, 0);
    const best = bestCost(arr, dealsByGroup[group] || []);
    dealt += best;
    if (full - best > 0) savingsByGroup[group] = full - best;
  }
  const total = dealt + other;
  return { regular, total, dealSavings: regular - total, savingsByGroup };
}

// ---- prices --------------------------------------------------------------
// group:   {id, name, unit, deals: [{qty, price}]}       (one set of prices everywhere)
// product: {id, group, price|null}                       (price = own price, e.g. trees; else group unit)
/** gmap: {groupId: group} */
export const unitPriceFor = (p, gmap) => p.price ?? gmap?.[p.group]?.unit ?? 0;
export const dealsFor = gmap => Object.fromEntries(Object.entries(gmap || {}).map(([g, v]) => [g, v.deals || []]));
/** A basket/sale line with the price copied in, so later price edits never change it. */
export const makeLine = (p, gmap, qty = 1) => ({ productId: p.id, qty, unitPrice: unitPriceFor(p, gmap), lineType: 'normal', note: '' });
