import { db, seedIfEmpty, repairStrayMarkers, getSetting, setSetting, openDay } from './db.js';
import { snapshotIfStale, takeSnapshot } from './sync.js';
import { startSyncLoop, syncChip, flush, refreshPending } from './gsync.js';
import { backupOverdue } from './syncing.js';
import * as settings from './settings.js';
import { overlay } from './ui.js';
import { $, esc, ymd } from './util.js';

const routes = { sell: ['Sell', () => import('./sell.js')], market: ['Market day', () => import('./market.js')], orders: ['Orders', () => import('./ordersview.js')],
  nursery: ['Nursery', () => import('./nursery.js')], packing: ['Packing', () => import('./packing.js')], reports: ['Reports', () => import('./reports.js')],
  products: ['Prices', () => import('./products.js')], settings: ['Backup', () => Promise.resolve(settings)] };
const MORE = ['packing', 'reports', 'products', 'settings'];   // phone: behind the More button
let waitingWorker = null;
const hadController = !!navigator.serviceWorker?.controller;   // false on a first install: nothing to update yet

async function chip() {
  const c = await syncChip(), el = $('#sync');
  el.textContent = c.text; el.className = c.level === 'bad' ? 'bad' : '';
  el.title = c.error || '';
}

/** One compact banner with the most urgent message; the rest sit behind "+N more". */
async function banners() {
  const items = [];   // most urgent first
  const [lastSync, lastBackup, closed] = [await getSetting('lastSync', 0), await getSetting('lastBackup', 0), await db.marketDays.where('status').equals('closed').toArray()];
  if (backupOverdue(closed.map(d => d.closedAt || 0), lastSync, lastBackup)) {
    items.push({ cls: 'red', href: '#settings', t: 'Backup overdue: more than 2 market days are not backed up. Back up now.' });
  } else if (await settings.backupDue()) {
    items.push({ href: '#settings', t: 'A market day closed since the last backup. Tap to back up.' });
  }
  if (waitingWorker) items.push((await openDay()) ? { t: 'Update ready. It installs after you close the market day.' } : { t: 'Update ready. <button class="btn small" id="install">Install update</button>' });
  if (!(navigator.standalone || matchMedia('(display-mode: standalone)').matches)) items.push({ href: '#settings', t: 'Open this from the Home Screen icon, not Safari, so your data is not cleared.' });
  if (navigator.storage?.persisted && !(await navigator.storage.persisted())) items.push({ href: '#settings', t: 'Storage is not protected from clearing.' });
  if (!items.length) return '';
  const one = it => (it.href ? `<a class="banner ${it.cls || ''}" href="${it.href}">${it.t}</a>` : `<div class="banner ${it.cls || ''}">${it.t}</div>`);
  const rest = items.slice(1);
  return `<div class="bwrap">${one(items[0])}${rest.length ? `<button class="linkbtn" id="bmore" aria-expanded="false" aria-controls="blist">+${rest.length} more</button><div id="blist" hidden>${rest.map(one).join('')}</div>` : ''}</div>`;
}

async function show() {
  const r = (location.hash.slice(1) in routes) ? location.hash.slice(1) : 'sell';
  $('#nav').innerHTML = Object.entries(routes).map(([k, [l]]) => `<a href="#${k}" class="${k === r ? 'on' : ''} ${MORE.includes(k) ? 'sec' : ''}">${l}</a>`).join('') + `<button class="more ${MORE.includes(r) ? 'on' : ''}" id="more">More</button>`;
  const main = $('#main'); main.innerHTML = '';
  main.onclick = main.onchange = main.oninput = null;
  try {
    await (await routes[r][1]()).render(main);
    main.insertAdjacentHTML('afterbegin', await banners());
  } catch (e) { main.innerHTML = `<div class="card"><h2>Something went wrong</h2><pre>${esc(String(e.stack || e))}</pre></div>`; }
  refreshPending().then(chip);
}

document.addEventListener('click', async e => {
  if (e.target.id === 'bmore') { const l = $('#blist'); l.hidden = !l.hidden; e.target.setAttribute('aria-expanded', String(!l.hidden)); e.target.textContent = l.hidden ? `+${l.children.length} more` : 'Show less'; }
  if (e.target.id === 'more') {
    const o = document.createElement('div'); o.className = 'overlay';
    o.innerHTML = `<div class="sheet"><h3>More</h3>${MORE.map(k => `<a class="btn big" href="#${k}">${routes[k][0]}</a>`).join('')}<button class="btn ghost">Close</button></div>`;
    o.onclick = ev => { if (ev.target === o || ev.target.closest('a,button')) o.remove(); };
    document.body.append(o);
  }
  if (e.target.id === 'sync') { const c = await syncChip(); if (c.level === 'off') location.hash = '#settings'; else { await flush({ force: true }); chip(); } }
  if (e.target.id === 'install') {
    if (await openDay()) return;   // never swap the app mid-market
    await takeSnapshot('before app update');
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  }
});

/** A new service worker waits until no market day is open and the user taps Install. */
function watchUpdates(reg) {
  const check = () => { if (hadController && reg.waiting && navigator.serviceWorker.controller) { waitingWorker = reg.waiting; show(); } };
  reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', check));
  check();
  setInterval(() => reg.update().catch(() => {}), 6 * 3600e3);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && waitingWorker) { reloaded = true; location.reload(); } });
}

/** First-run safety sheet. Shown on load before any screen is drawn, so nothing can be tapped underneath it. Resolves when accepted. */
async function welcome() {
  if (await getSetting('welcomeSeen')) return { done: Promise.resolve() };
  return { done: new Promise(done => {
    const o = overlay(`<h3>Before you start</h3><ul>
      <li><b>Open the app from its Home Screen icon</b>, not from Safari.</li>
      <li><b>Never delete the Home Screen icon.</b> Deleting it deletes all the data on this device.</li>
      <li><b>Never use "Clear History and Website Data"</b> in Safari settings.</li>
      <li>Carry a <b>power bank</b> on market days.</li>
      <li>Export a backup after every market (Backup tab), or connect the Google Sheet.</li></ul>
      <button class="btn primary big">I understand</button>`);
    o.querySelector('button').onclick = async () => { await setSetting('welcomeSeen', true); o.remove(); done(); };
  }) };
}

/** A market day still open from an earlier date (or more than 14 hours old) is probably forgotten: ask once per day. */
async function checkStaleDay() {
  const day = await openDay();
  if (!day || day.staleAsked === ymd()) return;
  const old = day.date < ymd() || (day.startedAt && Date.now() - day.startedAt > 14 * 3600e3);
  if (!old) return;
  await db.marketDays.update(day.id, { staleAsked: ymd() });
  const o = overlay(`<h3>An earlier market day is still open</h3><p>The market day on ${esc(day.date)} has not been closed.</p>
    <button class="btn primary big" data-a="close">Close it</button><button class="btn big" data-a="keep">Keep selling in it</button>`);
  o.onclick = async e => {
    const a = e.target.closest('button')?.dataset.a; if (!a) return;
    o.remove();
    if (a === 'close') { (await import('./market.js')).showReport(day.id); show(); }
  };
}

// One hand-lettered heading per screen: the first h2, kept up to date as screens re-render themselves.
new MutationObserver(() => {
  const main = $('#main'), first = main.querySelector('h2');
  main.querySelectorAll('h2.screen-h').forEach(h => { if (h !== first) h.classList.remove('screen-h'); });
  first?.classList.add('screen-h');
}).observe($('#main'), { childList: true, subtree: true });

(async () => {
  // Register first, so the app is cached for offline use even before the welcome sheet is dismissed.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(watchUpdates).catch(() => {});
  // There are no real users yet, so a database left by an older test build (a higher version than this one) is simply discarded.
  // Once real data exists, never do this: change the schema with db.version(N + 1) and an upgrade instead (see db.js).
  try { await db.open(); } catch (e) {
    if (e.name !== 'VersionError') throw e;
    await window.Dexie.delete('myrtle-creek'); location.reload(); return;
  }
  await seedIfEmpty();
  await repairStrayMarkers();
  navigator.storage?.persist?.().catch(() => {});
  addEventListener('hashchange', show);
  addEventListener('syncchange', chip);
  const w = await welcome();   // the sheet is already up (first run only) before any screen is drawn behind it
  await show();
  await w.done;
  checkStaleDay();
  startSyncLoop();
  snapshotIfStale().catch(() => {});
})();
