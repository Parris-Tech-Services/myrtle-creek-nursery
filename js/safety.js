// Safety snapshots live in their own small database, so no restore, import or reset of the main database can clear them.
// Kept: the snapshot taken just before the LAST restore (protected), the first snapshot of each of the last 3 days (protected),
// and the newest 5 of the rest.
const Dexie = window.Dexie;
const safety = new Dexie('myrtle-creek-safety');
safety.version(1).stores({ snapshots: 'id' });   // {id, ts, reason, protect?: 'restore', data: the sealed backup text}

export const KEEP = 5, DAYS = 3;
const dayOf = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** Pure. The ids that rotation must keep, given all snapshots. */
export function snapshotsToKeep(list, keep = KEEP, days = DAYS) {
  const sorted = [...list].sort((a, b) => b.ts - a.ts), protectedIds = new Set();
  const lastRestore = sorted.find(s => s.protect === 'restore');
  if (lastRestore) protectedIds.add(lastRestore.id);
  const firstOfDay = new Map();
  for (const s of [...sorted].reverse()) if (!firstOfDay.has(dayOf(s.ts))) firstOfDay.set(dayOf(s.ts), s);   // oldest first, so the first one seen is the first of its day
  [...firstOfDay.values()].sort((a, b) => b.ts - a.ts).slice(0, days).forEach(s => protectedIds.add(s.id));
  const rolling = sorted.filter(s => !protectedIds.has(s.id)).slice(0, keep);
  return new Set([...protectedIds, ...rolling.map(s => s.id)]);
}

/** Pure. Plain-English tags for the protected ones, for the Backup screen. */
export function snapshotLabels(list, days = DAYS) {
  const sorted = [...list].sort((a, b) => b.ts - a.ts), labels = {};
  const lastRestore = sorted.find(s => s.protect === 'restore');
  if (lastRestore) labels[lastRestore.id] = 'Before last restore (kept until the next restore)';
  const firstOfDay = new Map();
  for (const s of [...sorted].reverse()) if (!firstOfDay.has(dayOf(s.ts))) firstOfDay.set(dayOf(s.ts), s);
  [...firstOfDay.values()].sort((a, b) => b.ts - a.ts).slice(0, days).forEach(s => { labels[s.id] = (labels[s.id] ? labels[s.id] + '; ' : '') + 'First of the day (kept)'; });
  return labels;
}

/** protect: 'restore' marks the snapshot taken just before an import; it replaces the previous one of that kind. */
export async function saveSnapshot(sealedText, reason, { ts = Date.now(), protect } = {}) {
  const id = String(ts) + '-' + Math.random().toString(36).slice(2, 6);
  if (protect) for (const old of await safety.snapshots.filter(s => s.protect === protect).toArray()) await safety.snapshots.update(old.id, { protect: undefined });
  await safety.snapshots.put({ id, ts, reason, data: sealedText, ...(protect ? { protect } : {}) });
  const all = await safety.snapshots.toArray(), keepIds = snapshotsToKeep(all);
  await safety.snapshots.bulkDelete(all.filter(s => !keepIds.has(s.id)).map(s => s.id));
}
export const listSnapshots = async () => (await safety.snapshots.toArray()).sort((a, b) => b.ts - a.ts);
export const getSnapshot = id => safety.snapshots.get(id);
