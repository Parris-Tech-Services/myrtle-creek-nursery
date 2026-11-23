import { sum, lineNets } from './util.js';
import { productStats, suggestQty, minutesOf } from './insights.js';
import { reservedByProduct } from './orders.js';
import { STORES } from './syncing.js';
const Dexie = window.Dexie;

export const db = new Dexie('myrtle-creek');
/* SCHEMA CHANGES: never edit a version() that has shipped, because devices already hold data in it.
   To change tables add db.version(N + 1).stores({ ...only the changed tables }) and, if existing rows must be
   reshaped, chain .upgrade(tx => ...). Dexie then migrates each device's data in place. */
db.version(1).stores({
  types: 'id',                                   // Punnet / Tube / Tree: {id,name,sort,hidden}
  groups: 'id',                                  // pricing groups (deals pool within a group): {id,name,sort,unit,deals:[{qty,price}]}
  products: 'id,type,group,active',              // {id,type,group,category,name,price|null,active}
  locations: 'id',                               // {id,name,hidden}
  marketDays: 'id,date,location,status',
  sales: 'id,marketDayId,timestamp',
  stock: 'id,productId',                         // id = productId|locationId, nursery stock
  dayStock: 'id,marketDayId',                    // id = dayId|productId, {taken,returned}
  packing: 'id',                                 // user-edited packing quantities, id = locationId|productId
  batches: 'id,productId',
  cashMovements: 'id,marketDayId,type',
  orders: 'id,status,dueDate',                   // see orders.js
  losses: 'id,marketDayId,locationId,productId', // {productId,qty,reason,note,unitPrice,date,marketDayId|null,locationId}
  soldOut: 'id,marketDayId',                     // {marketDayId,productId,ts}
  snapshots: 'id',                               // rolling local safety copies (last 5)
  syncState: 'id',                               // {id:'store:id', acked: updatedAt, gone?}
  settings: 'key',
});

/** Every synced record carries updatedAt. Turned off while importing so the original timestamps are kept. */
export const stamping = { on: true };
for (const name of Object.keys(STORES)) {
  db[name].hook('creating', (pk, obj) => { if (stamping.on || !obj.updatedAt) obj.updatedAt = Date.now(); });
  db[name].hook('updating', () => (stamping.on ? { updatedAt: Date.now() } : undefined));
}

export const NURSERY = 'nursery';
/** People for "Who was there": [{name, hidden?}]. */
const DEFAULT_PEOPLE = [{ name: 'Luca' }, { name: 'Ysis' }];
export const getPeople = async () => (await getSetting('staffNames')) ?? DEFAULT_PEOPLE;
export const setPeople = list => setSetting('staffNames', list);
export const getSetting = async (k, d = null) => (await db.settings.get(k))?.value ?? d;
export const setSetting = (k, value) => db.settings.put({ key: k, value });

const CAT = 'Greens & herbs';
const SEED = [
  ['Tomato', 'seedling', 'Tube', ['Green Zebra', 'Tigerella', 'Stupice', 'Roma', 'Ox Heart', 'Mortgage Lifter']],
  ['Cherry tomato', 'seedling', 'Tube', ['Broad Ripple Yellow Currant', 'Camp Joy', 'Cherry Cocktail']],
  ['Dwarf tomato', 'seedling', 'Tube', ['Sweet Scarlet', 'Wilpena', 'Tasmanian Chocolate', 'Bundaberg Rumball']],
  ['Eggplant', 'seedling', 'Tube', ['Early Long Purple', 'Thai']],
  ['Capsicum', 'seedling', 'Tube', ['Californian Wonder']],
  ['Chilli', 'seedling', 'Tube', ['Jalapeno']],
  ['Basil', 'punnet', 'Punnet', ['Purple', 'Sweet', 'Tulsi', 'Thai', 'Mixed']],
  ['Cabbage', 'punnet', 'Punnet', ['Early Jersey Wakefield', 'Red Acre', 'Copenhagen']],
  ['Kale', 'punnet', 'Punnet', ['Nero di Toscana', 'Red Russian']],
  [CAT, 'punnet', 'Punnet', ['Beetroot', 'Bok Choi', 'Edible Chrysanthemum', 'Chamomile', 'Coriander', 'Lettuce Mix', 'Mizuna', 'Nasturtium',
    'Silverbeet', 'Rainbow Silverbeet', 'Stir Fry Mix', 'Tatsoi', 'Purple Sprouting Broccoli', 'Wombok', 'Rocket']],
];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function seedIfEmpty() {
  if (await getSetting('seeded')) return;
  const prods = SEED.flatMap(([category, group, type, names]) => names.map(name => ({
    id: slug(category === CAT ? name : category + '-' + name), type: slug(type), group, category, name, price: null, active: true })));
  const trees = [['Lemon (Meyer)', 3500], ['Fig', 3000], ['Apple (Pink Lady)', 4000]].map(([name, price]) => ({ id: slug(name), type: 'tree', group: 'tree', category: 'Fruit trees', name, price, active: true }));
  await db.transaction('rw', db.tables, async () => {
    await db.types.bulkPut([{ id: 'punnet', name: 'Punnet', sort: 1 }, { id: 'tube', name: 'Tube', sort: 2 }, { id: 'tree', name: 'Tree', sort: 3 }]);
    await db.groups.bulkPut([
      { id: 'seedling', name: 'Seedling', sort: 1, unit: 400, deals: [{ qty: 4, price: 1500 }] },
      { id: 'punnet', name: 'Vegetable punnet', sort: 2, unit: 500, deals: [{ qty: 5, price: 2000 }] },
      { id: 'tree', name: 'Tree', sort: 3, unit: 3000, deals: [] },
    ]);
    await db.products.bulkPut([...prods, ...trees]);
    await db.locations.bulkPut([
      { id: NURSERY, name: 'Nursery (near Pambula)' }, { id: 'jamison', name: 'Jamison Markets \u2013 Canberra' },
      { id: 'wyndham', name: 'Wyndham Markets' }, { id: 'pambula', name: 'Pambula pickup \u2013 Tuesdays' }, { id: 'southcoast', name: 'South Coast market' },
    ]);
    await db.stock.bulkPut([...prods, ...trees].map(p => ({ id: p.id + '|' + NURSERY, productId: p.id, locationId: NURSERY, qty: p.type === 'tree' ? 6 : 12 })));
    await setSetting('seeded', true);
  });
}

// ---- catalog -------------------------------------------------------------
const byName = (a, b) => a.name.localeCompare(b.name);
export async function catalog({ activeOnly = false } = {}) {
  const [types, groups, allProducts, locations] = await Promise.all([db.types.toArray(), db.groups.toArray(), db.products.toArray(), db.locations.toArray()]);
  types.sort((a, b) => (a.sort || 0) - (b.sort || 0) || byName(a, b));
  groups.sort((a, b) => (a.sort || 0) - (b.sort || 0) || byName(a, b));
  const label = p => (p.category === CAT || p.category === p.name || !p.category) ? p.name : `${p.category} - ${p.name}`;
  const ti = id => types.findIndex(t => t.id === id);
  const products = allProducts.map(p => ({ ...p, label: label(p) })).sort((a, b) => ti(a.type) - ti(b.type) || (a.category || '').localeCompare(b.category || '') || byName(a, b));
  const idx = a => Object.fromEntries(a.map(x => [x.id, x]));
  const pmap = idx(products);
  return { types, tmap: idx(types), groups, gmap: idx(groups), products: products.filter(p => !activeOnly || p.active), pmap, locations, lmap: idx(locations) };
}
export const markets = locs => locs.filter(l => l.id !== NURSERY && !l.hidden);

// ---- stock ---------------------------------------------------------------
export async function adjustStock(productId, delta, loc = NURSERY) {
  const id = productId + '|' + loc, r = await db.stock.get(id);
  await db.stock.put({ id, productId, locationId: loc, qty: (r?.qty || 0) + delta });
}
export const nurseryStock = async () => Object.fromEntries((await db.stock.toArray()).filter(s => s.locationId === NURSERY).map(s => [s.productId, s.qty]));

// ---- market days ---------------------------------------------------------
export const openDay = async () => (await db.marketDays.where('status').equals('open').sortBy('date')).pop();
export const salesForDay = async (dayId, withVoided = false) => (await db.sales.where('marketDayId').equals(dayId).sortBy('timestamp')).filter(s => withVoided || !s.voided);
export function soldByProduct(sales) {
  const m = {}; for (const s of sales) for (const l of s.lines) m[l.productId] = (m[l.productId] || 0) + l.qty; return m;
}
export function paymentTotals(sales, extra = []) {
  const t = { cash: 0, card: 0, transfer: 0 };
  for (const s of sales) {
    for (const p of s.payments || [{ method: s.paymentMethod, amount: s.total }]) t[p.method] = (t[p.method] || 0) + p.amount;
    t.cash += s.rounding || 0;   // 5c cash rounding: net cash kept = tendered - change = cash amount + rounding
  }
  for (const p of extra) t[p.method] = (t[p.method] || 0) + p.amount;
  return t;
}
/** Payments taken against orders while this market day was open. */
const orderPaymentsForDay = async id => (await db.orders.toArray()).flatMap(o => (o.payments || []).map(p => ({ ...p, customer: o.customer }))).filter(p => p.marketDayId === id);
export const dayReceipts = async (dayId, sales) => paymentTotals(sales, await orderPaymentsForDay(dayId));
/** Cash in the float should be: float + cash received + cash repaid - cash taken out. Also totals expenses. */
export const dayCash = async (day, sales) => {
  const mv = await db.cashMovements.where('marketDayId').equals(day.id).toArray();
  const extra = sum(mv.filter(m => m.type === 'float'), m => m.amount), out = sum(mv.filter(m => m.type === 'cashOut'), m => m.amount);
  const repaid = sum(mv.filter(m => m.type === 'repaid' && m.method === 'cash'), m => m.amount);
  const expenses = sum(mv.filter(m => (m.type === 'cashOut' || m.type === 'expense') && m.category && m.category !== 'borrowed'), m => m.amount);
  return { movements: mv, expenses, expected: (day.float || 0) + extra + (await dayReceipts(day.id, sales)).cash + repaid - out };
};
export const lossesForDay = id => db.losses.where('marketDayId').equals(id).toArray();
export const lostByProduct = ls => { const m = {}; for (const l of ls) m[l.productId] = (m[l.productId] || 0) + l.qty; return m; };
export const LOSS_REASONS = [['transport', 'Damaged in transport'], ['heat', 'Wilted / heat'], ['stolen', 'Stolen'], ['given', 'Given away / freebie'], ['dead', 'Dead'], ['other', 'Other']];

/** Cash outs across all days with remaining unpaid amount. */
export async function owed() {
  const all = await db.cashMovements.toArray();
  const paid = {}; for (const m of all) if (m.type === 'repaid') paid[m.linksTo] = (paid[m.linksTo] || 0) + m.amount;
  const list = all.filter(m => m.type === 'cashOut' && (!m.category || m.category === 'borrowed')).map(m => ({ ...m, remaining: m.amount - (paid[m.id] || 0) })).filter(m => m.remaining > 0)
    .sort((a, b) => a.ts - b.ts);
  return { list, total: sum(list, m => m.remaining) };
}

// ---- packing list --------------------------------------------------------
/** Closed visits as plain numbers, for insights.js. locationId null = every market. Newest first. */
export async function loadVisits(locationId = null) {
  const { pmap } = await catalog();
  const days = (await db.marketDays.toArray()).filter(d => d.status === 'closed' && !d.auto && (!locationId || d.location === locationId)).sort((a, b) => b.date.localeCompare(a.date));
  return Promise.all(days.map(async d => {
    const sales = await salesForDay(d.id), revenue = {};
    for (const s of sales) lineNets(s, pmap).forEach((n, i) => { const id = s.lines[i].productId; revenue[id] = (revenue[id] || 0) + n; });
    return {
      id: d.id, date: d.date, location: d.location, sold: soldByProduct(sales), revenue, lost: lostByProduct(await lossesForDay(d.id)),
      taken: Object.fromEntries((await db.dayStock.where('marketDayId').equals(d.id).toArray()).map(r => [r.productId, r.taken])),
      soldOutAt: Object.fromEntries((await db.soldOut.where('marketDayId').equals(d.id).toArray()).map(r => [r.productId, minutesOf(r.ts)])),
    };
  }));
}

/** Packing list for a market: this market's last 3 visits (sell-through, sold-out times) drive the suggestion. */
export async function packingPlan(locId) {
  const { products } = await catalog({ activeOnly: true });
  const stock = await nurseryStock();
  const held = reservedByProduct(await db.orders.toArray(), locId);
  const visits = (await loadVisits(locId)).slice(0, 3);
  const stats = productStats(visits);
  const edits = Object.fromEntries((await db.packing.toArray()).filter(p => p.id.startsWith(locId + '|')).map(p => [p.id, p.qty]));
  return products.map(p => {
    const st = stats[p.id], lastSold = visits[0]?.sold[p.id] || 0, lastTaken = visits[0]?.taken[p.id] || 0, heldHere = held[p.id] || 0;
    const { qty: suggested, reason } = suggestQty({ stats: st, lastTaken, lastSold, held: heldHere, stock: Math.max(0, stock[p.id] || 0) });
    const edited = edits[locId + '|' + p.id];
    return { product: p, lastTaken, lastSold, avg: st?.avgSold || 0, soldOut: st?.soldOut ? st.avgSoldOutMin : null, soldOutVisits: st?.soldOut || 0, held: heldHere, suggested, reason, edited, qty: edited ?? suggested, nursery: stock[p.id] || 0, visits: visits.length };
  });
}
