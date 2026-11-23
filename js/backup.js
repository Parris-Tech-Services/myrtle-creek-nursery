// Backup file format, validation and merging. No DOM and no database access: sync.js reads and writes the tables.
// Our data is plain JSON (strings, numbers, booleans, arrays and objects; no Dates, Blobs or Maps), so a backup is simply
// {format, formatVersion, exportedAt, appVersion, tables:{name:[rows]}, counts, sha256}.
import { STORES, mergeRecords } from './syncing.js';

export const FORMAT = 'mcn-backup';
export const FORMAT_VERSION = 1;
/** Tables that must be in every backup. */
export const REQUIRED_TABLES = ['types', 'groups', 'products', 'locations', 'marketDays', 'sales', 'stock', 'dayStock', 'batches', 'cashMovements', 'orders', 'losses', 'soldOut', 'packing', 'settings'];
/** Settings that belong to one device. They are never exported and a restore never overwrites them. */
export const DEVICE_KEYS = ['sheetConn', 'lastSync', 'lastBackup', 'welcomeSeen', 'checklistDone', 'seeded', 'basket'];

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Rows that carry export-library markers ("$types", or a "$" wrapper) are damaged copies, never real data. */
export function hasMarker(value) {
  if (Array.isArray(value)) return value.some(hasMarker);
  if (value && typeof value === 'object') return Object.keys(value).some(k => k === '$types' || k === '$') || Object.values(value).some(hasMarker);
  return false;
}

/** tables: {name: [rows]}. Device-only settings are dropped. Returns the finished JSON text. */
export async function sealBackup(tables, { exportedAt = Date.now(), appVersion = '' } = {}) {
  const clean = {};
  for (const [name, rows] of Object.entries(tables)) clean[name] = name === 'settings' ? rows.filter(r => !DEVICE_KEYS.includes(r.key)) : rows;
  const counts = Object.fromEntries(Object.entries(clean).map(([n, r]) => [n, r.length]));
  return JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt, appVersion, tables: clean, counts, sha256: await sha256(JSON.stringify(clean)) });
}

/**
 * Checks a backup completely before anything is changed. Returns {ok:true, doc, counts} or {ok:false, error}.
 * Catches truncated files, missing tables, row counts that do not match, edited or damaged data, and rows with export markers.
 */
export async function validateBackup(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { ok: false, error: 'This file is not a complete backup. It may have been cut short when it was saved or sent. Nothing was changed.' }; }
  if (doc?.format !== FORMAT || typeof doc.tables !== 'object' || !doc.tables) return { ok: false, error: 'This is not a Myrtle Creek backup file. Nothing was changed.' };
  if (doc.formatVersion !== FORMAT_VERSION) return { ok: false, error: 'This backup was made by a different version of the app. Nothing was changed.' };
  const missing = REQUIRED_TABLES.filter(t => !Array.isArray(doc.tables[t]));
  if (missing.length) return { ok: false, error: `This backup is missing: ${missing.join(', ')}. Nothing was changed.` };
  for (const [name, n] of Object.entries(doc.counts || {})) if (doc.tables[name]?.length !== n) return { ok: false, error: `The ${name} in this backup do not match what was saved (${doc.tables[name]?.length ?? 0} of ${n}). Nothing was changed.` };
  if (await sha256(JSON.stringify(doc.tables)) !== doc.sha256) return { ok: false, error: 'This backup file has been changed or damaged. Nothing was changed.' };
  for (const [name, rows] of Object.entries(doc.tables)) {
    if (!(name in STORES)) return { ok: false, error: `This backup has an unknown table (${name}). Nothing was changed.` };
    const pk = STORES[name];
    if (rows.some(r => !r || r[pk] === undefined || r[pk] === null || r[pk] === '')) return { ok: false, error: `Some ${name} in this backup have no id. Nothing was changed.` };
    if (hasMarker(rows)) return { ok: false, error: `The ${name} in this backup are damaged (export markers inside). Nothing was changed.` };
  }
  return { ok: true, doc, counts: doc.counts };
}

/** Per table, the rows of a backup that should be written in a merge: new ones, and ones with a newer updatedAt. Older or undated rows never win. */
export function mergePlan(doc, localByTable) {
  const plan = {};
  for (const [name, all] of Object.entries(doc.tables)) {
    const rows = name === 'settings' ? all.filter(r => !DEVICE_KEYS.includes(r.key)) : all;
    plan[name] = mergeRecords(name, localByTable[name] || [], rows, 'merge').write;
  }
  return plan;
}
