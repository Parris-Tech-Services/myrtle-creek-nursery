// The basket on the Sell screen is saved on every change, so a flat battery, a reload or an app update never loses a customer's order.
import { db } from './db.js';

const KEY = 'basket';
/** Lines {key, productId, qty, unitPrice, lineType, note, name?} for this market day, or []. */
export async function loadBasket(dayId) {
  const v = (await db.settings.get(KEY))?.value;
  return v && v.dayId === dayId ? v.lines : [];
}
export const saveBasket = (dayId, lines) => (lines.length ? db.settings.put({ key: KEY, value: { dayId, lines } }) : db.settings.delete(KEY));
