import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { APP_VERSION } from '../js/version.js';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');

test('service worker VERSION matches js/version.js', () => {
  assert.equal(sw.match(/const VERSION = '([^']+)'/)[1], APP_VERSION);
});

test('the precache list matches the app files on disk exactly', () => {
  const listed = [...sw.match(/const FILES = \[([\s\S]*?)\n\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  const dir = d => readdirSync(new URL(d, root)).map(f => d + f);
  const onDisk = ['./', 'index.html', 'manifest.webmanifest', 'apps-script.gs', ...dir('css/'), ...dir('js/'), ...dir('icons/'), ...dir('vendor/').filter(f => !f.endsWith('.txt'))].sort();
  assert.deepEqual(listed, onDisk);
});
