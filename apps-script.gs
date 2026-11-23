/**
 * Myrtle Creek Nursery: Google Sheet back-up and restore.
 * This script is bound to the template Sheet. Making a copy of the Sheet copies the script too.
 * Nothing to set up by hand: tabs and headers are created on the first request, and the secret key
 * is generated the first time it is needed (Project Settings > Script Properties > KEY).
 *
 * Requests: POST {key, action:'push', items:[...]}  -> {ok, acked:[keys]}
 *           GET  ?key=..&action=ping|counts|export&store=..&offset=..&limit=..
 *           GET  (no parameters) -> friendly page with the connection code (until the app has connected once)
 * Every record is an upsert keyed by id. An older copy never overwrites a newer one (updatedAt decides).
 */
const STORES = ['sales', 'marketDays', 'cashMovements', 'orders', 'losses', 'soldOut', 'stock', 'dayStock', 'batches', 'products', 'types', 'groups', 'locations', 'packing', 'settings'];
const sheetName_ = store => store.charAt(0).toUpperCase() + store.slice(1).replace(/^cashCounts$/, 'CashCounts');

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
    return json_({ ok: true, acked: push_(SpreadsheetApp.getActiveSpreadsheet(), data.items || []) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!p.action && !p.key) return connectPage_();
  if (p.key !== getKey_()) return json_({ ok: false, error: 'Wrong key' });
  if (p.action === 'ping') { PropertiesService.getScriptProperties().setProperty('CONNECTED', '1'); return json_({ ok: true, name: ss.getName() }); }
  if (p.action === 'counts') {
    const counts = {};
    STORES.forEach(function (s) { const sh = ss.getSheetByName(sheetName_(s)); counts[s] = sh ? Math.max(0, sh.getLastRow() - 1) : 0; });
    return json_({ ok: true, counts: counts });
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
}
function showHelp() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px;line-height:1.5"><ol>' +
    '<li>Extensions &gt; Apps Script &gt; <b>Deploy</b> &gt; <b>New deployment</b>.</li>' +
    '<li>Pick the gear &gt; <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Press <b>Deploy</b>.</li>' +
    '<li>Press <b>Authorize access</b>. If Google says it has not verified the app: <b>Advanced</b> &gt; <b>Go to ... (unsafe)</b>. It is your own script.</li>' +
    '<li>Back here: menu <b>Myrtle Creek &gt; Show connection code</b>, and Copy.</li>' +
    '<li>In the app: <b>Backup &gt; Connect Google Sheet</b>, paste, done.</li></ol></div>').setWidth(480).setHeight(360), 'How to connect');
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

// ---- storage ---------------------------------------------------------------
function sheetFor_(ss, store, cols) {
  const name = sheetName_(store);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    const header = ['id', 'updatedAt'].concat(cols, ['json']);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Upserts items grouped by store. Returns the keys that are safely stored (the app only trusts these). */
function push_(ss, items) {
  const acked = [];
  const byStore = {};
  items.forEach(function (it) { (byStore[it.store] = byStore[it.store] || []).push(it); });
  Object.keys(byStore).forEach(function (store) {
    const list = byStore[store];
    const first = list.filter(function (i) { return i.cols; })[0];
    if (!first && !ss.getSheetByName(sheetName_(store))) { list.forEach(function (i) { acked.push(i.key); }); return; }   // delete for a sheet that never existed
    const sh = sheetFor_(ss, store, first ? first.cols : []);
    const width = sh.getLastColumn();
    const last = sh.getLastRow();
    const index = {};
    if (last > 1) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r, i) { index[String(r[0])] = { row: i + 2, updatedAt: Number(r[1]) || 0 }; });
    const toDelete = [], fresh = [];
    list.forEach(function (it) {
      const at = index[String(it.id)];
      if (it.deleted) { if (at) toDelete.push(at.row); acked.push(it.key); return; }
      const values = [it.id, it.updatedAt].concat(it.cols.map(function (c) { const v = it.row[c]; return v === undefined || v === null ? '' : v; }), [it.json]);
      while (values.length < width) values.splice(values.length - 1, 0, '');
      if (at) { if (at.updatedAt <= it.updatedAt) sh.getRange(at.row, 1, 1, values.length).setValues([values]); }   // older copy never beats newer
      else { fresh.push(values); index[String(it.id)] = { row: -1, updatedAt: it.updatedAt }; }
      acked.push(it.key);
    });
    if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, fresh[0].length).setValues(fresh);
    toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  });
  return acked;
}

function export_(ss, store, offset, limit) {
  if (STORES.indexOf(store) < 0) return { ok: false, error: 'Unknown store' };
  const sh = ss.getSheetByName(sheetName_(store));
  if (!sh || sh.getLastRow() < 2) return { ok: true, records: [], next: null };
  const total = sh.getLastRow() - 1;
  const n = Math.min(limit, total - offset);
  if (n <= 0) return { ok: true, records: [], next: null };
  const jsonCol = sh.getLastColumn();
  const vals = sh.getRange(offset + 2, jsonCol, n, 1).getValues();
  const records = [];
  vals.forEach(function (r) { try { if (r[0]) records.push(JSON.parse(r[0])); } catch (e) { /* skip unreadable row */ } });
  return { ok: true, records: records, next: offset + n < total ? offset + n : null };
}
