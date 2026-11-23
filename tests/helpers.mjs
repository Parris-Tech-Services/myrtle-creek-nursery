// Test setup: an in-memory IndexedDB (fake-indexeddb, a dev-only dependency in tests/package.json) and the browser globals the app expects.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
globalThis.self = globalThis;   // dexie-export-import expects a browser-like global
/** Node has no FileReader; dexie-export-import uses it to read blobs. Minimal stand-in. */
globalThis.FileReader = class {
  _run(read) { read().then(r => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }, e => { this.error = e; this.onerror?.({ target: this }); }); }
  readAsArrayBuffer(b) { this._run(() => b.arrayBuffer()); }
  readAsText(b) { this._run(() => b.text()); }
  readAsDataURL(b) { this._run(async () => `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(await b.arrayBuffer()).toString('base64')}`); }
};
globalThis.window = globalThis;
globalThis.Dexie = Dexie;
globalThis.DexieExportImport = await import('dexie-export-import');

/** Empties every table in the app database. */
export async function resetDb(db) {
  await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(t => t.clear())));
}
