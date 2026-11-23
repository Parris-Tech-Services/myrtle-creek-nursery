export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c || 0) / 100).toFixed(2);
/** "$150", "1,234.50" and " 150 " all work. Returns whole cents, or null if the text is not an amount (never NaN). */
export function parseMoney(v) {
  const t = String(v ?? '').replace(/[\s$]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
/** Blank or unreadable text counts as 0. Use parseMoney when you need to tell the difference. */
export const toCents = v => parseMoney(v) ?? 0;
export const MAX_QTY = 999;
export const clampQty = (n, min = 0) => Math.min(MAX_QTY, Math.max(min, Math.round(Number(n)) || 0));
export const dollars = c => ((c || 0) / 100).toFixed(2);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
export const pad = n => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtDateTime = t => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never';
export const sum = (a, f = x => x) => a.reduce((t, x) => t + (f(x) || 0), 0);
export const groupBy = (a, f) => a.reduce((m, x) => ((m[f(x)] ||= []).push(x), m), {});

/** Net revenue per sale line: gross less this type's deal savings, shared across normal lines. */
export function lineNets(sale, pmap) {
  const gross = {};
  for (const l of sale.lines) if (l.lineType === 'normal') {
    const t = pmap[l.productId]?.group; gross[t] = (gross[t] || 0) + l.qty * l.unitPrice;
  }
  return sale.lines.map(l => {
    const g = l.qty * l.unitPrice, t = pmap[l.productId]?.group;
    const sv = l.lineType === 'normal' && gross[t] ? (sale.savingsByGroup?.[t] || 0) * g / gross[t] : 0;
    return Math.round(g - sv);
  });
}
