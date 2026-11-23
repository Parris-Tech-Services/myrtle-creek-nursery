// Safety snapshots live in their own small database, so no restore, import or reset of the main database can clear them.
const Dexie = window.Dexie;
const safety = new Dexie('myrtle-creek-safety');
safety.version(1).stores({ snapshots: 'id' });   // {id, ts, reason, data: the sealed backup text}

export const KEEP = 5;
export async function saveSnapshot(sealedText, reason, ts = Date.now()) {
  await safety.snapshots.put({ id: String(ts) + '-' + Math.random().toString(36).slice(2, 6), ts, reason, data: sealedText });
  const all = (await safety.snapshots.toArray()).sort((a, b) => b.ts - a.ts);
  await safety.snapshots.bulkDelete(all.slice(KEEP).map(x => x.id));
}
export const listSnapshots = async () => (await safety.snapshots.toArray()).sort((a, b) => b.ts - a.ts);
export const getSnapshot = id => safety.snapshots.get(id);
