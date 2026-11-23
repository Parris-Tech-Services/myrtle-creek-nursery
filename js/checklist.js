import { getSetting, setSetting } from './db.js';
import { getConn } from './gsync.js';
import { $ } from './util.js';

/** First-run card, dismissible. Shown on the Sell and Market screens when no day is open. */
export async function checklistCard() {
  if (await getSetting('checklistDone')) return '';
  const conn = await getConn();
  return `<div class="card" id="checklist"><h3>Getting started</h3>
    <div class="kv"><a href="#products">Check your prices</a></div>
    <div class="kv"><a href="#products">Add the people who help at markets</a></div>
    <div class="kv"><a href="#settings">Connect Google Sheet (optional)</a>${conn ? '<span class="tag ok">Done</span>' : ''}</div>
    <button class="btn small ghost" id="cl-dismiss">Dismiss</button></div>`;
}
export function wireChecklist(root, rerender) {
  $('#cl-dismiss', root)?.addEventListener('click', async () => { await setSetting('checklistDone', true); rerender(); });
}
