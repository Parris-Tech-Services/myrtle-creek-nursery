// Test setup: an in-memory IndexedDB (fake-indexeddb, a dev-only dependency in tests/package.json) and the browser globals the app expects.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
globalThis.window = globalThis;
globalThis.Dexie = Dexie;

/** Empties every table in the app database. */
export async function resetDb(db) {
  await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(t => t.clear())));
}
globalThis.dispatchEvent ||= () => true;   // the app announces sync changes to the page; nothing listens in tests
