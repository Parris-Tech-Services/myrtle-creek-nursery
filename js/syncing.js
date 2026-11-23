// Pure sync logic (no DOM, no database): what is pending, acks, backoff, restore merge, connection code.
// Every synced record carries updatedAt. A record is "pending" until the sheet acknowledges that exact updatedAt.

/** Synced stores and the field that holds each record's id. */
export const STORES = {
  sales: 'id', marketDays: 'id', cashMovements: 'id', orders: 'id', losses: 'id', soldOut: 'id', stock: 'id', dayStock: 'id',
  batches: 'id', products: 'id', types: 'id', groups: 'id', locations: 'id', packing: 'id', settings: 'key',
};
/** Only these settings are copied to the sheet. Never the connection key. */
export const SYNCED_SETTINGS = ['lastFloat', 'nextFloat', 'staffNames', 'stallFees'];
export const idOf = (store, rec) => String(rec[STORES[store]]);

/**
 * live:  {store: [records]}   state: {'store:id': {acked, gone}}
 * Returns operations still to send: new or changed records, and records deleted since they were acked.
 */
export function pendingOps(live, state, now = Date.now()) {
  const ops = [], seen = new Set();
  for (const [store, recs] of Object.entries(live)) {
    for (const r of recs) {
      const id = idOf(store, r), key = store + ':' + id, s = state[key]; seen.add(key);
      if (!s || s.gone || (r.updatedAt || 0) > (s.acked ?? -1)) ops.push({ key, store, id, updatedAt: r.updatedAt || 0, deleted: false });
    }
  }
  for (const [key, s] of Object.entries(state)) {
    const store = key.slice(0, key.indexOf(':'));
    if (store in live && !seen.has(key) && !s.gone) ops.push({ key, store, id: key.slice(store.length + 1), updatedAt: now, deleted: true });
  }
  return ops;
}
export const batch = (ops, size = 50) => Array.from({ length: Math.ceil(ops.length / size) }, (_, i) => ops.slice(i * size, (i + 1) * size));

/** Only keys the sheet returned in `acked` become synced; everything else stays pending. Returns state rows to save. */
export function applyAcks(sent, acked) {
  const ok = new Set(acked || []);
  return sent.filter(o => ok.has(o.key)).map(o => ({ id: o.key, acked: o.updatedAt, gone: o.deleted || undefined }));
}
export const backoffMs = failures => Math.min(15 * 60e3, 5000 * 2 ** Math.max(0, failures));

/** Restore from sheet. replace: take everything. merge: take remote records that are new or newer (by updatedAt). */
export function mergeRecords(store, local, remote, mode) {
  if (mode === 'replace') return { write: remote, keptLocal: 0 };
  const have = new Map(local.map(r => [idOf(store, r), r.updatedAt || 0]));
  const write = remote.filter(r => !have.has(idOf(store, r)) || (r.updatedAt || 0) > have.get(idOf(store, r)));
  return { write, keptLocal: remote.length - write.length };
}

export const encodeConnection = (url, key) => btoa(JSON.stringify({ u: url, k: key }));
export function decodeConnection(code) {
  try {
    const o = JSON.parse(atob(String(code).replace(/\s+/g, '')));
    if (typeof o.u === 'string' && /^https:\/\//.test(o.u) && typeof o.k === 'string' && o.k.length >= 8) return { url: o.u, key: o.k };
  } catch { /* fall through */ }
  return null;
}

/** Red-banner rule: more than `limit` market days closed since the last successful sync or export. */
export const backupOverdue = (closedAts, lastSync = 0, lastBackup = 0, limit = 2) => closedAts.filter(t => t > Math.max(lastSync || 0, lastBackup || 0)).length > limit;

/** "All backed up", "3 waiting for signal", "Sync error (tap)" for the header chip. */
export function chipState({ connected, online, pending, error }) {
  if (!connected) return { text: pending ? 'Not backed up online' : 'Online backup off', level: 'off' };
  if (error) return { text: 'Sync error (tap)', level: 'bad' };
  if (!pending) return { text: 'All backed up ✓', level: 'ok' };
  return { text: online ? `${pending} syncing` : `${pending} waiting for signal`, level: 'wait' };
}
