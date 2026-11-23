// Backup file format, validation and merging. No DOM; the database is only touched by sync.js.
// A backup is the dexie-export-import JSON plus a marker, "mcnBackup", with a format number, per-table counts and a SHA-256 of the data.
import { STORES, idOf, mergeRecords } from './syncing.js';

export const FORMAT = 1;
/** Tables that must be in every backup. */
export const REQUIRED_TABLES = ['types', 'groups', 'products', 'locations', 'marketDays', 'sales', 'stock', 'dayStock', 'batches', 'cashMovements', 'orders', 'losses', 'soldOut', 'packing', 'settings'];
/** Settings that belong to one device. They are never exported and a restore never overwrites them. */
export const DEVICE_KEYS = ['sheetConn', 'lastSync', 'lastBackup', 'welcomeSeen', 'checklistDone', 'seeded', 'basket'];

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Takes the text of a dexie export, drops device-only settings, and adds the marker. Returns the finished JSON text. */
export async function sealBackup(exportText, exportedAt = Date.now()) {
  const doc = JSON.parse(exportText);
  for (const t of doc.data.data) {
    if (t.tableName === 'settings') t.rows = t.rows.filter(r => !DEVICE_KEYS.includes(r.key));
  }
  for (const meta of doc.data.tables) { const t = doc.data.data.find(x => x.tableName === meta.name); if (t) meta.rowCount = t.rows.length; }
  const counts = Object.fromEntries(doc.data.data.map(t => [t.tableName, t.rows.length]));
  doc.mcnBackup = { format: FORMAT, exportedAt, counts, sha256: await sha256(JSON.stringify(doc.data)) };
  return JSON.stringify(doc);
}

/**
 * Checks a backup completely before anything is changed. Returns {ok:true, doc, counts} or {ok:false, error}.
 * Catches truncated files, missing tables, row counts that do not match, and edited or damaged data.
 */
export async function validateBackup(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { ok: false, error: 'This file is not a complete backup. It may have been cut short when it was saved or sent. Nothing was changed.' }; }
  const m = doc?.mcnBackup;
  if (doc?.formatName !== 'dexie' || !doc?.data?.data) return { ok: false, error: 'This is not a Myrtle Creek backup file. Nothing was changed.' };
  if (!m || m.format !== FORMAT) return { ok: false, error: 'This backup has no valid marker. Export a new one from the app. Nothing was changed.' };
  const have = new Map(doc.data.data.map(t => [t.tableName, t.rows]));
  const missing = REQUIRED_TABLES.filter(t => !have.has(t));
  if (missing.length) return { ok: false, error: `This backup is missing: ${missing.join(', ')}. Nothing was changed.` };
  for (const [name, n] of Object.entries(m.counts || {})) if (!Array.isArray(have.get(name)) || have.get(name).length !== n) return { ok: false, error: `The ${name} in this backup do not match what was saved (${have.get(name)?.length ?? 0} of ${n}). Nothing was changed.` };
  if (await sha256(JSON.stringify(doc.data)) !== m.sha256) return { ok: false, error: 'This backup file has been changed or damaged. Nothing was changed.' };
  return { ok: true, doc, counts: m.counts };
}

/** Per table, the rows of a backup that should be written in a merge: new ones, and ones with a newer updatedAt. Older or undated rows never win. */
export function mergePlan(doc, localByTable) {
  const plan = {};
  for (const t of doc.data.data) {
    if (!(t.tableName in STORES)) continue;
    const rows = t.tableName === 'settings' ? t.rows.filter(r => !DEVICE_KEYS.includes(r.key)) : t.rows;
    plan[t.tableName] = mergeRecords(t.tableName, localByTable[t.tableName] || [], rows, 'merge').write;
  }
  return plan;
}
export { idOf };
