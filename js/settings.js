import { db, getSetting } from './db.js';
import { exportBackup, importBackup, restoreSnapshot } from './sync.js';
import { getConn, connect, disconnect, flush, pending, remoteCounts, localCounts, restoreFromSheet, syncStatus, scriptOutdated, resendAll } from './gsync.js';
import { esc, fmtDateTime, $ } from './util.js';
import { toast, confirmBox, choose, overlay, notice, askForm } from './ui.js';
import { listSnapshots, snapshotLabels } from './safety.js';
import { replaceGuard } from './backup.js';
import { APP_VERSION } from './version.js';

export async function backupDue() {
  const last = await getSetting('lastBackup', 0);
  return (await db.marketDays.where('status').equals('closed').toArray()).some(d => (d.closedAt || 0) > last);
}

export async function render(root) {
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const conn = await getConn();
  const snaps = await listSnapshots(), labels = snapshotLabels(snaps);
  root.innerHTML = `<div class="card"><h2>Backup</h2>
    <div class="kv"><span>Last backup</span><b>${fmtDateTime(await getSetting('lastBackup'))}</b></div>
    ${await backupDue() ? '<p class="warn-text">A market day has been closed since your last backup.</p>' : ''}
    <button class="btn primary big" id="backup-all">Backup everything</button>
    <p class="muted">Downloads one complete backup file containing every record.</p>
    <h3>Restore or combine</h3>
    <p class="muted">Restore replaces everything on this device. Merge adds another device's file, matching by id so nothing doubles up.</p>
    <input type="file" id="file" accept=".json,application/json" hidden>
    <div class="row"><button class="btn danger" id="restore">Restore (replace all)</button><button class="btn" id="merge">Merge another file</button></div></div>
  <div class="card"><h2>Automatic safety copies</h2><p class="muted">The app keeps its last 5 snapshots on this device (and takes one before any import). Use one if an import goes wrong.</p>
    ${snaps.map(x => `<div class="kv"><span>${fmtDateTime(x.ts)} <small>${esc(x.reason)}${labels[x.id] ? ' &middot; ' + esc(labels[x.id]) : ''}</small></span><button class="btn small danger" data-snap="${x.id}">Restore</button></div>`).join('') || '<p class="muted">None yet.</p>'}</div>
  <div class="card"><h2>Google Sheet backup</h2>
    ${conn ? `<p><b>Connected \u2713</b> to ${esc(conn.name)}</p>
    ${scriptOutdated(conn) ? '<div class="banner">Your Google Sheet needs a small update. Your data is safe on this device. <button class="btn small" id="howupdate">How to update</button></div>' : ''}
    <div class="kv"><span>Waiting to send</span><b>${(await pending()).length}</b></div>
    <div class="kv"><span>Last successful sync</span><b>${fmtDateTime(await getSetting('lastSync'))}</b></div>${syncStatus.error ? `<p class="tag bad">Last sync problem: ${esc(syncStatus.error)}</p>` : ''}
    <div class="row"><button class="btn primary" id="sync">Sync now</button><button class="btn" id="gres">Restore from Google Sheet</button><button class="btn" id="resend">Resend everything</button><button class="btn danger" id="disc">Disconnect</button></div>`
    : `<p class="muted">Copies every sale, order and stock change to your own Google Sheet and keeps a copy you can restore from.</p>
    <label><span>Connect Google Sheet: paste the connection code</span><textarea id="code" rows="3" placeholder="Paste code here"></textarea></label>
    <button class="btn primary big" id="connect">Connect Google Sheet</button>`}</div>
  <div class="card"><h2>This device</h2>
    <div class="kv"><span>Storage protected from clearing</span><b>${persisted == null ? 'unknown' : persisted ? 'Yes' : 'No'}</b></div>
    ${est ? `<div class="kv"><span>Storage used</span><b>${(est.usage / 1048576).toFixed(1)} MB</b></div>` : ''}
    <div class="kv"><span>App version</span><b>${APP_VERSION}</b></div>
    <div class="kv"><span>Running as installed app</span><b>${standalone ? 'Yes' : 'No - add to Home Screen'}</b></div>
    ${persisted === false ? '<button class="btn" id="persist">Ask for protection</button>' : ''}</div>`;

  let mode = 'merge';
  root.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'backup-all') { (await exportBackup()) ? toast('Complete backup downloaded') : toast('Backup cancelled'); return render(root); }
    if (b.dataset.snap) { if (await confirmBox('Replace all current data with this snapshot?', 'Restore', true)) { try { await restoreSnapshot(b.dataset.snap); location.reload(); } catch (err) { await notice('Could not restore', err.message); } } return; }
    if (b.id === 'restore' || b.id === 'merge') { mode = b.id; if (mode === 'restore' && !await confirmBox('Restore will REPLACE all data on this device with the file. Continue?', 'Continue', true)) return; $('#file').click(); }
    if (b.id === 'sync') { if (syncStatus.busy) { toast('Already syncing. This can take a minute the first time.', 4000); return; } const r = await flush({ force: true }); toast(r.error ? 'Sync error: ' + r.error : navigator.onLine ? `Synced (${r.sent} sent)` : 'No signal. It will sync when you are back online.', 4000); return render(root); }
    if (b.id === 'connect') {
      try { const name = await connect($('#code').value); toast(`Connected \u2713 to ${name}`, 3500); } catch (e) { toast(e.message, 5000); }
      return render(root);
    }
    if (b.id === 'disc') { if (await confirmBox('Disconnect from the Google Sheet? Your data stays on this device and in the sheet.', 'Disconnect', true)) { await disconnect(); render(root); } return; }
    if (b.id === 'gres') return restoreFlow(root);
    if (b.id === 'howupdate') return updateDialog();
    if (b.id === 'resend') { if (await confirmBox('Send every record to the sheet again? This is safe and can take a minute.', 'Resend')) { toast('Sending everything...', 3000); const r = await resendAll(); toast(r.error ? 'Sync error: ' + r.error : `Sent ${r.sent} records`, 4000); render(root); } return; }
    if (b.id === 'persist') { await navigator.storage.persist(); render(root); }
  };
  $('#file', root).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!await confirmBox(`${mode === 'restore' ? 'Replace all data with' : 'Merge'} "${f.name}"?`, mode === 'restore' ? 'Replace' : 'Merge', mode === 'restore')) return;
    try { await importBackup(f, mode); toast('Done'); location.reload(); } catch (err) { await notice('Could not import this file', err.message); }
    e.target.value = '';
  };
}

async function restoreFlow(root) {
  let remote, local;
  try { [remote, local] = await Promise.all([remoteCounts(), localCounts()]); } catch (e) { return toast('Could not read the sheet: ' + e.message, 5000); }
  const lines = Object.keys(remote).map(k => `${k}: ${remote[k]} in sheet, ${local[k] || 0} on this device`).join('\n');
  const mode = await choose('Restore from Google Sheet', [['merge', 'Merge (newest change wins)'], ['replace', 'Replace this device with the sheet']], lines);
  if (!mode) return;
  let confirmedLoss = false;
  if (mode === 'replace') {
    const guard = replaceGuard(remote, local);
    if (guard.block) return notice('Replace refused', guard.block);
    if (guard.warn) {   // much smaller than this device: make the user type the word
      const v = await askForm('Replace with a smaller Sheet?', [{ name: 'word', label: guard.warn + ' Type REPLACE to continue.' }], {}, { submit: 'Replace' });
      if (!v) return;
      if (v.word !== 'REPLACE') return notice('Not replaced', 'You did not type REPLACE, so nothing was changed.');
      confirmedLoss = true;
    } else if (!await confirmBox('Replace everything on this device with the sheet? A safety snapshot is taken first.', 'Replace', true)) return;
  }
  try { const w = await restoreFromSheet(mode, { confirmedLoss }); toast(`Restored ${Object.values(w).reduce((a, b) => a + b, 0)} records`, 4000); setTimeout(() => location.reload(), 800); } catch (e) { await notice('Restore failed', e.message); }
}

/** Steps for updating the script in the Sheet. The new script text is fetched from this app's own files. */
function updateDialog() {
  const o = overlay(`<h3>Update your Google Sheet</h3><p>Your link stays the same, so you do not need to reconnect.</p>
    <button class="btn primary big" id="copyscript">Copy new script</button>
    <ol><li>Open your Google Sheet. Choose <b>Extensions</b>, then <b>Apps Script</b>.</li>
    <li>Click in the code, select all, and <b>paste</b> the new script over it. Click <b>Save</b>.</li>
    <li>Click <b>Deploy</b>, then <b>Manage deployments</b>.</li>
    <li>Click the pencil (edit) icon. Under <b>Version</b> choose <b>New version</b>, then <b>Deploy</b>.</li>
    <li>Back in the app, tap <b>Sync now</b>, then <b>Resend everything</b> so existing sales create the <b>Sale lines</b> tab.</li></ol>
    <button class="btn ghost" id="closeupdate">Close</button>`);
  o.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'closeupdate') o.remove();
    if (b.id === 'copyscript') {
      let text = '';
      try { text = await (await fetch('apps-script.gs', { cache: 'reload' })).text(); } catch { return toast('Could not load the script. Check your connection.', 4000); }
      const ta = Object.assign(document.createElement('textarea'), { value: text }); ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
      if (!ok) try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
      toast(ok ? 'Script copied' : 'Could not copy automatically', 3000); b.textContent = ok ? 'Script copied \u2713' : 'Copy new script';
    }
  };
}
