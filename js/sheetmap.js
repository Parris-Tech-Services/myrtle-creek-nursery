// What each store looks like in the readable Google Sheet tabs. Pure: no DOM, no database.
// Column types tell the Apps Script how to store and format each cell: text | date | time | money | num | dec.
// Dates travel as 'YYYY-MM-DD', times as 'HH:MM', money as dollars (a number). Booleans are 'Yes' or blank.
import { DENOMS, denomLabel } from './cash.js';
import { paidTotal, paymentStatus } from './orders.js';
import { peopleText, totalPersonHours } from './staff.js';

const T = (...pairs) => pairs.map(([h, t]) => ({ h, t }));
const denomCols = DENOMS.flatMap(d => [{ h: `Open ${denomLabel(d)}`, t: 'num' }]).concat(DENOMS.map(d => ({ h: `Close ${denomLabel(d)}`, t: 'num' })));

/** Tab name -> columns, in the order the tabs appear in the sheet (after "Start here"). */
export const TABS = {
  'Sales': T(['Date', 'date'], ['Time', 'time'], ['Market', 'text'], ['Items', 'text'], ['Units', 'num'], ['Total', 'money'], ['Deal savings', 'money'], ['Payment', 'text'], ['Cash given', 'money'], ['Change', 'money'], ['Rounding', 'money'], ['Voided', 'text']),
  'Market days': T(['Date', 'date'], ['Market', 'text'], ['Status', 'text'], ['Weather', 'text'], ['Crowd (1-5)', 'num'], ['Set-up', 'time'], ['Pack-up', 'time'], ['People', 'text'], ['Person-hours', 'dec'], ['Opening float', 'money'], ['Cash counted', 'money'], ['Kept for next market', 'money'], ['Banked', 'money'], ['Notes', 'text']),
  'Cash counts': [...T(['Date', 'date'], ['Market', 'text'], ['Opening float', 'money'], ['Cash it should be', 'money'], ['Cash counted', 'money'], ['Over / short', 'money'], ['Kept for next market', 'money'], ['Banked', 'money']), ...denomCols],
  'Expenses & cash out': T(['Date', 'date'], ['Market', 'text'], ['Type', 'text'], ['Category', 'text'], ['Amount', 'money'], ['Paid from', 'text'], ['Note', 'text']),
  'Orders': T(['Customer', 'text'], ['Due', 'date'], ['Status', 'text'], ['Payment', 'text'], ['Total', 'money'], ['Paid', 'money'], ['Handover', 'text'], ['Market', 'text'], ['Items', 'text'], ['Phone', 'text'], ['Address', 'text'], ['Collected on', 'date'], ['Notes', 'text']),
  'Losses': T(['Date', 'date'], ['Market', 'text'], ['Product', 'text'], ['Quantity', 'num'], ['Reason', 'text'], ['Value', 'money'], ['Note', 'text']),
  'Stock taken & returned': T(['Date', 'date'], ['Market', 'text'], ['Product', 'text'], ['Taken', 'num'], ['Returned', 'num']),
  'Sold out': T(['Date', 'date'], ['Product', 'text'], ['Sold out at', 'time'], ['Market', 'text']),
  'Nursery stock': T(['Product', 'text'], ['Location', 'text'], ['In stock', 'num']),
  'Growing batches': T(['Product', 'text'], ['Started', 'date'], ['Method', 'text'], ['Quantity started', 'num'], ['Lost', 'num'], ['Moved to stock', 'num'], ['Expected ready', 'date'], ['Notes', 'text']),
  'Products & prices': T(['Kind', 'text'], ['Name', 'text'], ['Sub-category', 'text'], ['Type', 'text'], ['Pricing group', 'text'], ['Own price', 'money'], ['Group price', 'money'], ['Deals', 'text'], ['Shown on Sell', 'text']),
  'People': T(['Name', 'text'], ['Shown in lists', 'text']),
};

/** Readable tabs to clear a record from when it is deleted. Types, locations, settings and packing have no tab (they live only in _data). */
export const TABS_OF_STORE = {
  sales: ['Sales'], marketDays: ['Market days', 'Cash counts'], cashMovements: ['Expenses & cash out'], orders: ['Orders'], losses: ['Losses'], dayStock: ['Stock taken & returned'],
  soldOut: ['Sold out'], stock: ['Nursery stock'], batches: ['Growing batches'], products: ['Products & prices'], groups: ['Products & prices'],
};
export const tabDefs = names => Object.fromEntries(names.map(n => [n, TABS[n]]));

const pad = n => String(n).padStart(2, '0');
export const hhmm = ts => (ts ? `${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}` : '');
const $ = c => (c == null || c === '' ? '' : c / 100);
const yes = b => (b ? 'Yes' : '');
const PAY = { none: 'Free', cash: 'Cash', card: 'Card', transfer: 'Transfer / PayID', split: 'Split', order: 'Order (paid earlier)' };
const FUL = { market: 'Pick up at market', pambula: 'Pick up at Pambula', delivery: 'Delivery' };
const STATUS = { open: 'Open', closed: 'Closed', held: 'Held', collected: 'Collected', cancelled: 'Cancelled' };
const PAYST = { unpaid: 'Unpaid', part: 'Part paid', paid: 'Paid' };
const REASON = { transport: 'Damaged in transport', heat: 'Wilted / heat', stolen: 'Stolen', given: 'Given away', dead: 'Dead', other: 'Other' };
const METHOD = { cash: 'Float', card: 'Card', transfer: 'Transfer / PayID' };
const CAT = { stallfee: 'Stall fee', fuel: 'Fuel', supplies: 'Supplies', borrowed: 'Borrowed from the float', other: 'Other' };
const MOVE = { cashOut: 'Cash out', expense: 'Expense', float: 'Float added', repaid: 'Repaid' };

/**
 * rec: a stored record. ctx: {days:{id:day}, loc(id), pn(id, line), gmap, tmap, cash} where cash is the cash-count summary for a market day.
 * Returns {rows:[{tab, id, cells}], replaceTabs?:[tab]}. Each row's cells line up with TABS[tab].
 */
export function rowsFor(store, rec, ctx) {
  const id = `${store}:${rec.id ?? rec.key}`, day = ctx.days?.[rec.marketDayId], date = day?.date || '';
  const one = (tab, cells) => ({ rows: [{ tab, id, cells }] });
  switch (store) {
    case 'sales': return one('Sales', [date, hhmm(rec.timestamp), ctx.loc(day?.location), rec.lines.map(l => `${l.qty} x ${ctx.pn(l.productId, l)}${l.lineType && l.lineType !== 'normal' ? ' (' + l.lineType + ')' : ''}`).join('; '),
      rec.lines.reduce((t, l) => t + l.qty, 0), $(rec.total), $(rec.dealSavings), PAY[rec.paymentMethod] || rec.paymentMethod, $(rec.cashTendered), $(rec.changeGiven), $(rec.rounding), yes(rec.voided)]);
    case 'marketDays': {
      const c = ctx.cash || {}, rows = [{ tab: 'Market days', id, cells: [rec.date, ctx.loc(rec.location), STATUS[rec.status] || rec.status, rec.weather || '', rec.crowd || '', rec.setupTime || '', rec.packupTime || '',
        peopleText(rec), totalPersonHours(rec) || '', $(rec.float), $(rec.countedCash), $(rec.keepFloat), $(rec.banked), rec.notes || ''] }];
      rows.push({ tab: 'Cash counts', id, cells: [rec.date, ctx.loc(rec.location), $(rec.float), c.expected == null ? '' : c.expected / 100, $(rec.countedCash),
        rec.countedCash == null || c.expected == null ? '' : (rec.countedCash - c.expected) / 100, $(rec.keepFloat), $(rec.banked),
        ...DENOMS.map(d => rec.floatCounts?.[d] || ''), ...DENOMS.map(d => rec.closeCounts?.[d] || '')] });
      return { rows };
    }
    case 'cashMovements': return one('Expenses & cash out', [rec.date || date, ctx.loc(day?.location), MOVE[rec.type] || rec.type, CAT[rec.category] || rec.category || '', $(rec.amount), METHOD[rec.method] || (rec.type === 'cashOut' ? 'Float' : ''), rec.note || '']);
    case 'orders': return one('Orders', [rec.customer, rec.dueDate || '', STATUS[rec.status] || rec.status, PAYST[paymentStatus(rec)], $(rec.total), $(paidTotal(rec)), FUL[rec.fulfilment] || rec.fulfilment,
      ctx.loc(rec.locationId), rec.lines.map(l => `${l.qty} x ${ctx.pn(l.productId, l)}`).join('; '), rec.phone || '', rec.address || '', rec.collectedDate || '', rec.notes || '']);
    case 'losses': return one('Losses', [rec.date, ctx.loc(rec.locationId), ctx.pn(rec.productId), rec.qty, REASON[rec.reason] || rec.reason, rec.qty * rec.unitPrice / 100, rec.note || '']);
    case 'dayStock': return one('Stock taken & returned', [date, ctx.loc(day?.location), ctx.pn(rec.productId), rec.taken, rec.returned ?? '']);
    case 'soldOut': return one('Sold out', [date, ctx.pn(rec.productId), hhmm(rec.ts), ctx.loc(day?.location)]);
    case 'stock': return one('Nursery stock', [ctx.pn(rec.productId), ctx.loc(rec.locationId), rec.qty]);
    case 'batches': return one('Growing batches', [ctx.pn(rec.productId), rec.startDate || '', rec.method === 'potted' ? 'Potted' : 'Sown', rec.qtyStarted, rec.losses || 0, rec.moved || 0, rec.expectedReady || '', rec.notes || '']);
    case 'products': return one('Products & prices', ['Product', rec.name, rec.category || '', ctx.tmap?.[rec.type]?.name || rec.type, ctx.gmap?.[rec.group]?.name || rec.group, $(rec.price), '', '', yes(rec.active)]);
    case 'groups': return one('Products & prices', ['Pricing group', rec.name, '', '', rec.name, '', $(rec.unit), [(rec.deals || []).map(d => `${d.qty} for $${(d.price / 100).toFixed(2)}`).join(', '), ...Object.entries(rec.locPrices || {}).map(([id, o]) => `${ctx.loc?.(id) || id}: $${(o.unit / 100).toFixed(2)} each` + (o.deals || []).map(d => `, ${d.qty} for $${(d.price / 100).toFixed(2)}`).join(''))].filter(Boolean).join('; '), '']);
    case 'settings':
      if (rec.key !== 'staffNames') return { rows: [] };
      return { replaceTabs: ['People'], rows: (rec.value || []).map(p => ({ tab: 'People', id: 'people:' + p.name, cells: [p.name, yes(!p.hidden)] })) };
    default: return { rows: [] };   // types, locations, packing: only in _data
  }
}
