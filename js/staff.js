// Who was at a market day, and person-hours. Pure.
/** 'HH:MM' -> minutes since midnight, or null. */
export const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };

/** Hours for one person: their own arrive/leave, else the day's set-up / pack-up times. Null if either end is unknown. */
export function personHours(p, day = {}) {
  const a = toMin(p.arrive) ?? toMin(day.setupTime), l = toMin(p.leave) ?? toMin(day.packupTime);
  return a == null || l == null || l <= a ? null : (l - a) / 60;
}
export const totalPersonHours = day => (day.staff || []).reduce((t, p) => t + (personHours(p, day) || 0), 0);
/** Net per person-hour in cents, or null when no hours are known. */
export const netPerHour = (net, day) => { const h = totalPersonHours(day); return h > 0 ? Math.round(net / h) : null; };
export const peopleText = day => (day.staff || []).map(p => p.name).join(', ');

/** Chip labels: first name only when it is unique in the list, otherwise the full name. */
export function displayNames(names) {
  const first = n => n.trim().split(/\s+/)[0];
  const count = {}; for (const n of names) count[first(n)] = (count[first(n)] || 0) + 1;
  return Object.fromEntries(names.map(n => [n, count[first(n)] === 1 ? first(n) : n]));
}
