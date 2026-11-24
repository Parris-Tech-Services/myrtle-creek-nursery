import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const next = process.argv[2];
if (!/^mcn-v\d+$/.test(next || '')) {
  console.error('Usage: npm run version:bump -- mcn-v26');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');
const swPath = resolve(root, 'sw.js');
const versionPath = resolve(root, 'js/version.js');
const sw = readFileSync(swPath, 'utf8');
const version = readFileSync(versionPath, 'utf8');

if (!/const VERSION = 'mcn-v\d+';/.test(sw)) throw new Error('Could not find service-worker VERSION');
if (!/export const APP_VERSION = 'mcn-v\d+';/.test(version)) throw new Error('Could not find APP_VERSION');

writeFileSync(swPath, sw.replace(/const VERSION = 'mcn-v\d+';/, `const VERSION = '${next}';`));
writeFileSync(versionPath, version.replace(/export const APP_VERSION = 'mcn-v\d+';/, `export const APP_VERSION = '${next}';`));
console.log(`Updated app version to ${next}`);
