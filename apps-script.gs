/**
 * Myrtle Creek Nursery: Google Sheet back-up and restore.
 * This script is bound to the template Sheet. Making a copy of the Sheet copies the script too.
 * Nothing to set up by hand: the tabs, headings and the "Start here" steps are written on the first request,
 * and the secret key is generated the first time it is needed (Project Settings > Script Properties > KEY).
 *
 * Two kinds of storage:
 *   _data (hidden)   store | id | updatedAt | json. Everything the app can restore from lives only here.
 *   readable tabs    Sales, Market days, ... for sorting, filtering and pivot tables. Column A holds a hidden row id.
 * Every record is an upsert. An older copy never overwrites a newer one (updatedAt decides).
 *
 * Requests: POST {key, action:'push', tabs, items}  -> {ok, acked:[keys], stale:[{key, json}], scriptVersion}
 *           GET  ?key=..&action=ping|counts|export&store=..&offset=..&limit=..
 *           GET  (no parameters) -> friendly page with the connection code (until the app has connected once)
 */
const SCRIPT_VERSION = 2;   // the app checks this. Raise it whenever the script changes in a way the app depends on.
const STORES = ['sales', 'marketDays', 'cashMovements', 'orders', 'losses', 'soldOut', 'stock', 'dayStock', 'batches', 'products', 'types', 'groups', 'locations', 'packing', 'settings'];
const DATA_TAB = '_data';
const START_TAB = 'Start here';
const TAB_ORDER = ['Start here', 'Sales', 'Sale lines', 'Market days', 'Cash counts', 'Expenses & cash out', 'Orders', 'Losses', 'Stock taken & returned', 'Sold out', 'Nursery stock', 'Growing batches', 'Products & prices', 'People'];
const NUMFMT = { date: 'ddd d mmm yyyy', time: 'h:mm am/pm', money: '$#,##0.00', num: '0', dec: '0.0#' };

function getKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); props.setProperty('KEY', key); }
  return key;
}
function webUrl_() {
  const url = ScriptApp.getService().getUrl();
  return url ? url.replace(/\/dev$/, '/exec') : null;
}
function connectionCode_() {
  const url = webUrl_();
  return url ? Utilities.base64Encode(JSON.stringify({ u: url, k: getKey_() })) : null;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---- web app ---------------------------------------------------------------
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.key !== getKey_()) return json_({ ok: false, error: 'Wrong key' });
    if (data.action !== 'push') return json_({ ok: false, error: 'Unknown action' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    startHere_(ss);
    const done = push_(ss, data.tabs || {}, data.items || []);
    return json_({ ok: true, acked: done.acked, stale: done.stale, scriptVersion: SCRIPT_VERSION });
  } catch (err) {
    return json_({ ok: false, error: String(err), scriptVersion: SCRIPT_VERSION });
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!p.action && !p.key) return connectPage_();
  if (p.key !== getKey_()) return json_({ ok: false, error: 'Wrong key' });
  if (p.action === 'ping') {
    PropertiesService.getScriptProperties().setProperty('CONNECTED', '1');
    startHere_(ss);
    return json_({ ok: true, name: ss.getName(), scriptVersion: SCRIPT_VERSION });
  }
  if (p.action === 'counts') {
    const counts = {};
    STORES.forEach(function (s) { counts[s] = 0; });
    dataRows_(ss).forEach(function (r) { if (counts[r[0]] !== undefined) counts[r[0]]++; });
    return json_({ ok: true, counts: counts, scriptVersion: SCRIPT_VERSION });
  }
  if (p.action === 'export') return json_(export_(ss, p.store, Number(p.offset) || 0, Math.min(Number(p.limit) || 200, 500)));
  return json_({ ok: false, error: 'Unknown action' });
}

function connectPage_() {
  const connected = PropertiesService.getScriptProperties().getProperty('CONNECTED');
  const code = connectionCode_();
  let body;
  if (connected) body = '<p>This sheet is already connected to the app.</p><p>To see the connection code again, open the Sheet and choose <b>Myrtle Creek &gt; Show connection code</b>.</p>';
  else if (!code) body = '<p>Not deployed yet. In the Sheet choose Extensions &gt; Apps Script &gt; Deploy &gt; New deployment.</p>';
  else body = '<p>Copy this code, then in the app go to <b>Backup &gt; Connect Google Sheet</b> and paste it.</p>' +
    '<textarea id="c" readonly rows="6" style="width:100%;font-size:16px">' + code + '</textarea><p><button style="font-size:18px;padding:12px 20px" onclick="var c=document.getElementById(\'c\');c.select();navigator.clipboard?navigator.clipboard.writeText(c.value):document.execCommand(\'copy\');this.textContent=\'Copied\'">Copy</button></p>' +
    '<p style="color:#666">Keep this code private. This page hides the code once the app has connected.</p>';
  return HtmlService.createHtmlOutput('<div style="font-family:sans-serif;max-width:560px;margin:24px auto;padding:0 16px"><h2>Myrtle Creek Nursery</h2>' + body + '</div>').setTitle('Myrtle Creek Nursery');
}

// ---- sheet menu ------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Myrtle Creek')
    .addItem('How to connect', 'showHelp')
    .addItem('Show connection code', 'showCode')
    .addItem('Show the code page again', 'resetConnected')
    .addToUi();
  try { startHere_(SpreadsheetApp.getActiveSpreadsheet()); } catch (e) { /* never block opening the sheet */ }
}
function showHelp() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px;line-height:1.5"><ol>' +
    '<li>Extensions &gt; Apps Script &gt; <b>Deploy</b> &gt; <b>New deployment</b>.</li>' +
    '<li>Pick the gear &gt; <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Press <b>Deploy</b>.</li>' +
    '<li>Press <b>Authorize access</b>. If Google says it has not verified the app: <b>Advanced</b> &gt; <b>Go to ... (unsafe)</b>. It is your own script.</li>' +
    '<li><b>Click the blue Web app URL</b> shown after deploying. A page opens with your connection code. Press <b>Copy</b>. (Or use the menu <b>Myrtle Creek &gt; Show connection code</b>.)</li>' +
    '<li>In the app: <b>Backup &gt; Connect Google Sheet</b>, paste, done.</li></ol></div>').setWidth(480).setHeight(380), 'How to connect');
}
function showCode() {
  const code = connectionCode_();
  const html = code
    ? '<div style="font-family:sans-serif"><p>Copy this code into the app (Backup &gt; Connect Google Sheet).</p><textarea id="c" readonly rows="7" style="width:100%;font-size:15px">' + code + '</textarea>' +
      '<p><button style="font-size:16px;padding:10px 18px" onclick="var c=document.getElementById(\'c\');c.select();document.execCommand(\'copy\');this.textContent=\'Copied\'">Copy</button></p></div>'
    : '<div style="font-family:sans-serif"><p>This sheet is not deployed yet. Use <b>Myrtle Creek &gt; How to connect</b> first.</p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(360), 'Connection code');
}
function resetConnected() { PropertiesService.getScriptProperties().deleteProperty('CONNECTED'); SpreadsheetApp.getUi().alert('The code page will show the code again until the app next connects.'); }

// ---- "Start here" tab: plain English steps, written by the script ----------
function startHere_(ss) {
  const props = PropertiesService.getScriptProperties();
  let sh = ss.getSheetByName(START_TAB);
  if (!sh) {
    const first = ss.getSheetByName('Sheet1');
    if (first) { first.setName(START_TAB); sh = first; } else sh = ss.insertSheet(START_TAB);
  }
  if (props.getProperty('START_V') === String(SCRIPT_VERSION) && sh.getRange(1, 1).getValue() !== '') return;
  const lines = [
    ['Myrtle Creek Nursery: your sales and stock, backed up here'],
    [''],
    ['This sheet keeps a safe copy of everything you record in the app. It fills itself in whenever your phone or iPad has signal.'],
    [''],
    ['To connect it (you only do this once)'],
    ['1.  In this sheet, open the menu Extensions, then Apps Script.'],
    ['2.  Click Deploy (top right), then New deployment.'],
    ['3.  Click the cog next to "Select type" and choose Web app.'],
    ['4.  Set "Execute as" to Me and "Who has access" to Anyone. Click Deploy.'],
    ['5.  Click Authorize access and choose your Google account. If it says "Google hasn\'t verified this app", click Advanced, then Go to (your project) (unsafe). It is your own copy, so this is fine.'],
    ['6.  Click the blue Web app URL shown after deploying. A page opens with a code. Click Copy.'],
    ['7.  In the app, go to Backup, then Connect Google Sheet, and paste the code.'],
    [''],
    ['Good to know'],
    ['-  Please don\'t rename or delete the tabs. The app relies on them.'],
    ['-  The tabs are for reading, sorting and filtering. Changes you type here are not sent back to the app.'],
    ['-  Your data stays in your own Google account.'],
    ['-  If the app says "Your Google Sheet needs a small update", open the app, go to Backup, and tap How to update.'],
    ['-  Need help? Ask Dan.'],
  ];
  sh.clear();
  sh.getRange(1, 1, lines.length, 1).setValues(lines).setWrap(true).setVerticalAlignment('top');
  sh.setColumnWidth(1, 640);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(16);
  sh.getRange(5, 1).setFontWeight('bold'); sh.getRange(14, 1).setFontWeight('bold');
  sh.setHiddenGridlines(true);
  props.setProperty('START_V', String(SCRIPT_VERSION));
  arrange_(ss);
}

// ---- storage ---------------------------------------------------------------
function dataSheet_(ss) {
  let sh = ss.getSheetByName(DATA_TAB);
  if (!sh) {
    sh = ss.insertSheet(DATA_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['store', 'id', 'updatedAt', 'json']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}
function dataRows_(ss) {
  const sh = ss.getSheetByName(DATA_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
}

function conv_(v, t) {
  if (v === '' || v === null || v === undefined) return '';
  if (t === 'date') { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : String(v); }
  if (t === 'time') { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v)); return m ? (+m[1] * 60 + +m[2]) / 1440 : String(v); }
  if (t === 'money' || t === 'num' || t === 'dec') return Number(v);
  const t0 = String(v);
  return /^[=+\-@]/.test(t0) ? "'" + t0 : t0;   // text that starts with = + - @ would otherwise be read as a formula
}

/** Creates a readable tab once: bold olive header, frozen row, filter, hidden id column. Returns {sh, cols, idx, fresh, del, created}. */
function tab_(ss, cache, name, defs) {
  if (cache[name]) return cache[name];
  const cols = defs[name];
  let sh = ss.getSheetByName(name), created = false;
  if (!sh) {
    if (!cols) return null;
    sh = ss.insertSheet(name); created = true;
    const header = ['id'].concat(cols.map(function (c) { return c.h; }));
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#e5ebd9');
    sh.setFrozenRows(1);
    sh.hideColumns(1);
    sh.getRange(1, 1, Math.max(2, sh.getMaxRows()), header.length).createFilter();
  }
  const idx = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r, i) { idx[String(r[0])] = i + 2; });
  cache[name] = { sh: sh, cols: cols || [], idx: idx, fresh: [], del: [], created: created };
  return cache[name];
}

/** Upserts items. Returns the keys that are safely stored (the app only trusts these). */
function push_(ss, defs, items) {
  const data = dataSheet_(ss);
  const dIdx = {};
  if (data.getLastRow() > 1) data.getRange(2, 1, data.getLastRow() - 1, 3).getValues().forEach(function (r, i) { dIdx[r[0] + '|' + r[1]] = { row: i + 2, updatedAt: Number(r[2]) || 0 }; });
  const dFresh = [], dDel = [], cache = {}, acked = [], stale = [];

  items.forEach(function (it) {
    try {
      const k = it.store + '|' + it.id, ex = dIdx[k];
      if (it.deleted) {
        if (ex) { dDel.push(ex.row); delete dIdx[k]; }
        (it.deleteRows || []).forEach(function (r) { const t = tab_(ss, cache, r.tab, defs); if (t && t.idx[r.id]) { t.del.push(t.idx[r.id]); delete t.idx[r.id]; } });
        acked.push(it.key); return;
      }
      if (ex && ex.updatedAt > it.updatedAt) {   // the sheet already has a newer copy: keep it, and send it back so the app can take it
        stale.push({ key: it.key, json: data.getRange(ex.row, 4).getValue() });
        acked.push(it.key); return;
      }
      if (ex) { data.getRange(ex.row, 1, 1, 4).setValues([[it.store, String(it.id), it.updatedAt, it.json]]); ex.updatedAt = it.updatedAt; }
      else { dFresh.push([it.store, String(it.id), it.updatedAt, it.json]); dIdx[k] = { row: -1, updatedAt: it.updatedAt }; }
      (it.replaceTabs || []).forEach(function (name) {
        const t = tab_(ss, cache, name, defs); if (!t) return;
        if (t.sh.getLastRow() > 1) t.sh.getRange(2, 1, t.sh.getLastRow() - 1, t.sh.getLastColumn()).clearContent();   // clear, not delete: a sheet cannot lose all its non-frozen rows
        t.idx = {}; t.fresh = [];
      });
      (it.rows || []).forEach(function (r) {
        const t = tab_(ss, cache, r.tab, defs); if (!t) return;
        const values = [r.id].concat(r.cells.map(function (v, i) { return conv_(v, t.cols[i] && t.cols[i].t); }));
        const at = t.idx[r.id];
        if (at) t.sh.getRange(at, 1, 1, values.length).setValues([values]);
        else { t.fresh.push(values); t.idx[r.id] = -1; }
      });
      acked.push(it.key);
    } catch (err) { /* leave this one un-acked so the app retries it */ }
  });

  if (dFresh.length) data.getRange(data.getLastRow() + 1, 1, dFresh.length, 4).setValues(dFresh);
  dDel.sort(function (a, b) { return b - a; }).forEach(function (r) { try { data.deleteRow(r); } catch (e) { data.getRange(r, 1, 1, 4).clearContent(); } });
  Object.keys(cache).forEach(function (name) {
    const t = cache[name], sh = t.sh;
    if (t.fresh.length) {
      const start = sh.getLastRow() + 1, need = start + t.fresh.length - 1;
      if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
      sh.getRange(start, 1, t.fresh.length, t.fresh[0].length).setValues(t.fresh);
      t.cols.forEach(function (c, i) { if (NUMFMT[c.t]) sh.getRange(start, i + 2, t.fresh.length, 1).setNumberFormat(NUMFMT[c.t]); });
    }
    t.del.sort(function (a, b) { return b - a; }).forEach(function (r) { try { sh.deleteRow(r); } catch (e) { sh.getRange(r, 1, 1, sh.getLastColumn()).clearContent(); } });
    if (t.created) sh.autoResizeColumns(2, Math.max(1, t.cols.length));
  });
  arrange_(ss);
  return { acked: acked, stale: stale };
}

function arrange_(ss) {
  TAB_ORDER.forEach(function (name, i) {
    const sh = ss.getSheetByName(name);
    if (sh) { ss.setActiveSheet(sh); ss.moveActiveSheet(Math.min(i + 1, ss.getNumSheets())); }
  });
  const data = ss.getSheetByName(DATA_TAB);
  if (data) { ss.setActiveSheet(data); ss.moveActiveSheet(ss.getNumSheets()); }
  const first = ss.getSheetByName(START_TAB);
  if (first) ss.setActiveSheet(first);
}

function export_(ss, store, offset, limit) {
  if (STORES.indexOf(store) < 0) return { ok: false, error: 'Unknown store' };
  const rows = dataRows_(ss).filter(function (r) { return r[0] === store; });
  const slice = rows.slice(offset, offset + limit);
  const records = [];
  slice.forEach(function (r) { try { if (r[3]) records.push(JSON.parse(r[3])); } catch (e) { /* skip unreadable row */ } });
  return { ok: true, records: records, next: offset + limit < rows.length ? offset + limit : null, scriptVersion: SCRIPT_VERSION };
}
