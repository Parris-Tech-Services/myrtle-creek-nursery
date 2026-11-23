// Google Sheet sync: confirmed push (the sheet must acknowledge each id) and restore from the sheet.
import { db, getSetting, setSetting, catalog, stamping } from './db.js';
import { STORES, SYNCED_SETTINGS, idOf, pendingOps, batch, applyAcks, backoffMs, mergeRecords, decodeConnection, chipState } from './syncing.js';
import { takeSnapshot, cashRow } from './sync.js';
import { rowsFor, tabDefs, TABS_OF_STORE } from './sheetmap.js';

/** The Sheet's script must be at least this version for the app's sync to work (see apps-script.gs SCRIPT_VERSION). */
export const REQUIRED_SCRIPT_VERSION = 2;
const status = { error: null, failures: 0, nextTry: 0, busy: false, pending: 0, scriptVersion: undefined };
export const syncStatus = status;
const notify = () => window.dispatchEvent(new Event('syncchange'));
export const getConn = () => getSetting('sheetConn');

async function liveRecords() {
  const live = {};
  for (const name of Object.keys(STORES)) live[name] = await db[name].toArray();
  live.settings = live.settings.filter(r => SYNCED_SETTINGS.includes(r.key));
  return live;
}
const stateMap = async () => Object.fromEntries((await db.syncState.toArray()).map(r => [r.id, r]));
export async function pending() { return pendingOps(await liveRecords(), await stateMap()); }
export async function isAcked(store, rec) { const s = await db.syncState.get(store + ':' + idOf(store, rec)); return !!s && s.acked >= (rec.updatedAt || 0); }
export async function ackedSet() { const m = await stateMap(); return (store, rec) => (m[store + ':' + idOf(store, rec)]?.acked ?? -1) >= (rec.updatedAt || 0); }

// What the readable Sheet tabs look like lives in sheetmap.js. Restore data always goes in _data as the full json record.
async function buildItems(ops) {
  const cat = await catalog(), days = Object.fromEntries((await db.marketDays.toArray()).map(d => [d.id, d]));
  const c = { days, gmap: cat.gmap, tmap: cat.tmap, loc: id => cat.lmap[id]?.name || id || '', pn: (id, l) => cat.pmap[id]?.label || l?.name || id };
  const items = [], tabs = new Set();
  for (const op of ops) {
    const base = { key: op.key, store: op.store, id: op.id, updatedAt: op.updatedAt };
    if (op.deleted) { items.push({ ...base, deleted: true, deleteRows: (TABS_OF_STORE[op.store] || []).map(tab => ({ tab, id: `${op.store}:${op.id}` })) }); (TABS_OF_STORE[op.store] || []).forEach(t => tabs.add(t)); continue; }
    const rec = await db[op.store].get(op.id);
    if (!rec) continue;
    const ctx = op.store === 'marketDays' ? { ...c, cash: await cashRow(rec, cat.lmap) } : c;
    const { rows, replaceTabs } = rowsFor(op.store, rec, ctx);
    rows.forEach(r => tabs.add(r.tab)); (replaceTabs || []).forEach(t => tabs.add(t));
    items.push({ ...base, json: JSON.stringify(rec), rows, ...(replaceTabs ? { replaceTabs } : {}) });
  }
  return { items, tabs: tabDefs([...tabs]) };
}

async function call(conn, init, params) {
  const url = init ? conn.url : conn.url + (conn.url.includes('?') ? '&' : '?') + new URLSearchParams({ key: conn.key, ...params });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 90000);   // never let a stuck request block syncing
  let res;
  try { res = await fetch(url, { ...(init ? { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key: conn.key, ...init }) } : {}), signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'The Google Sheet took too long to answer' : 'Could not reach the Google Sheet. If this keeps happening, redeploy the script as a New version (' + e.message + ')'); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (j.scriptVersion !== undefined) status.scriptVersion = j.scriptVersion;
  if (!j.ok) throw new Error(j.error || 'The sheet refused the request');
  return j;
}

/** Push every pending record, 50 per request. A record only counts as synced once its id comes back in `acked`. */
export async function flush({ force = false } = {}) {
  const conn = await getConn();
  if (!conn || !navigator.onLine || status.busy) { await refreshPending(); return { sent: 0 }; }
  if (!force && Date.now() < status.nextTry) return { sent: 0 };
  status.busy = true; let sent = 0;
  try {
    if (force || status.scriptVersion === undefined) { const j = await call(conn, null, { action: 'ping' }).catch(() => null); status.scriptVersion = j ? (j.scriptVersion ?? 0) : undefined; }
    if (status.scriptVersion !== undefined && status.scriptVersion < REQUIRED_SCRIPT_VERSION) {   // an old script cannot read the new format: wait, do not spam errors
      status.nextTry = Date.now() + 10 * 60e3; return { sent: 0, outdated: true };
    }
    for (const group of batch(await pending(), 50)) {
      const { items, tabs } = await buildItems(group);
      const r = await call(conn, { action: 'push', tabs, items });
      if (r.migrated && !flush.retried) { flush.retried = true; await db.syncState.clear(); status.busy = false; const again = await flush({ force: true }); flush.retried = false; return again; }
      const rows = applyAcks(group, r.acked);
      await db.syncState.bulkPut(rows);
      sent += rows.length;
      if (rows.length < group.length) throw new Error(`${group.length - rows.length} record(s) were not acknowledged`);
    }
    status.error = null; status.failures = 0; status.nextTry = 0;
    if (sent) await setSetting('lastSync', Date.now());
  } catch (e) {
    status.error = e.message; status.failures++; status.nextTry = Date.now() + backoffMs(status.failures);
  } finally { status.busy = false; await refreshPending(); }
  return { sent, error: status.error };
}

export async function refreshPending() { status.pending = (await pending()).length; notify(); return status.pending; }
export const scriptOutdated = conn => !!conn && status.scriptVersion !== undefined && status.scriptVersion < REQUIRED_SCRIPT_VERSION;

/** Forget what was synced so every record is sent again (recovery, or after the sheet's script was updated). */
export async function resendAll() { await db.syncState.clear(); status.error = null; status.nextTry = 0; return flush({ force: true }); }

export async function syncChip() {
  const conn = await getConn();
  if (scriptOutdated(conn)) return { text: 'Google Sheet needs an update', level: 'off', error: null };
  return { ...chipState({ connected: !!conn, online: navigator.onLine, pending: status.pending, error: status.error }), error: status.error };
}

/** Retry on start, when back online, when the app comes to the front, and every 60 s while anything is waiting. */
export function startSyncLoop() {
  const go = () => flush();
  addEventListener('online', () => { status.nextTry = 0; go(); });
  addEventListener('offline', notify);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go(); });
  setInterval(() => { if (status.pending > 0 || status.error) go(); }, 60000);
  go();
}

// ---- connect / disconnect --------------------------------------------------
export async function connect(code) {
  const c = decodeConnection(code);
  if (!c) throw new Error('That does not look like a connection code. Copy it again from the sheet.');
  const j = await call(c, null, { action: 'ping' });
  status.scriptVersion = j.scriptVersion ?? 0;
  await setSetting('sheetConn', { url: c.url, key: c.key, name: j.name });
  status.error = null; status.failures = 0; status.nextTry = 0;
  flush({ force: true });
  return j.name;
}
export const disconnect = async () => { await db.settings.delete('sheetConn'); status.error = null; await refreshPending(); };

// ---- restore from the sheet -------------------------------------------------
export async function remoteCounts() { const conn = await getConn(); if (!conn) throw new Error('Connect a sheet first'); return (await call(conn, null, { action: 'counts' })).counts; }
export async function localCounts() { const live = await liveRecords(); return Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.length])); }

export async function restoreFromSheet(mode) {
  const conn = await getConn();
  await takeSnapshot('before restore from sheet');
  const remote = {};
  for (const store of Object.keys(STORES)) {
    remote[store] = [];
    for (let offset = 0; offset !== null && offset !== undefined;) {
      const j = await call(conn, null, { action: 'export', store, offset: String(offset), limit: '200' });
      remote[store].push(...j.records); offset = j.next;
    }
  }
  const written = {};
  stamping.on = false;
  try {
    await db.transaction('rw', db.tables.filter(t => t.name in STORES), db.syncState, async () => {
      for (const [store, recs] of Object.entries(remote)) {
        const local = mode === 'merge' ? await db[store].toArray() : [];
        const { write } = mergeRecords(store, local, recs, mode);
        if (mode === 'replace' && store !== 'settings') await db[store].clear();   // settings hold this device's own state
        await db[store].bulkPut(write);
        await db.syncState.bulkPut(write.map(r => ({ id: store + ':' + idOf(store, r), acked: r.updatedAt || 0 })));
        written[store] = write.length;
      }
      await db.settings.put({ key: 'seeded', value: true });
      await db.settings.put({ key: 'sheetConn', value: conn });   // keep this device connected
    });
  } finally { stamping.on = true; }
  await refreshPending();
  return written;
}
