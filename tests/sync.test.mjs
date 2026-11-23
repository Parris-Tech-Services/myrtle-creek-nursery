import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingOps, batch, applyAcks, backoffMs, mergeRecords, decodeConnection, backupOverdue, chipState } from '../js/syncing.js';

const encodeConnection = (url, key) => btoa(JSON.stringify({ u: url, k: key }));

const live = { sales: [{ id: 'a', updatedAt: 10 }, { id: 'b', updatedAt: 20 }], settings: [{ key: 'lastFloat', updatedAt: 5 }] };

test('everything is pending before the first sync', () => {
  assert.deepEqual(pendingOps(live, {}).map(o => o.key), ['sales:a', 'sales:b', 'settings:lastFloat']);
});
test('only acked ids become synced; the rest stay pending', () => {
  const ops = pendingOps(live, {});
  const rows = applyAcks(ops, ['sales:a', 'settings:lastFloat']);
  assert.deepEqual(rows.map(r => r.id), ['sales:a', 'settings:lastFloat']);
  const state = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(pendingOps(live, state).map(o => o.key), ['sales:b']);
});
test('an edit after the ack makes the record pending again, and acks the version that was sent', () => {
  const sent = pendingOps({ sales: [{ id: 'a', updatedAt: 10 }] }, {});
  const state = { 'sales:a': applyAcks(sent, ['sales:a'])[0] };
  assert.equal(pendingOps({ sales: [{ id: 'a', updatedAt: 10 }] }, state).length, 0);
  assert.equal(pendingOps({ sales: [{ id: 'a', updatedAt: 11 }] }, state).length, 1);
});
test('a failed request (no acks) leaves everything pending', () => {
  assert.deepEqual(applyAcks(pendingOps(live, {}), undefined), []);
  assert.deepEqual(applyAcks(pendingOps(live, {}), []), []);
});
test('deleted records are sent as deletes once, then settle', () => {
  const state = { 'sales:gone': { id: 'sales:gone', acked: 3 }, 'sales:a': { acked: 10 } };
  const ops = pendingOps({ sales: [{ id: 'a', updatedAt: 10 }] }, state, 99);
  assert.deepEqual(ops, [{ key: 'sales:gone', store: 'sales', id: 'gone', updatedAt: 99, deleted: true }]);
  const rows = applyAcks(ops, ['sales:gone']);
  assert.equal(rows[0].gone, true);
  assert.equal(pendingOps({ sales: [{ id: 'a', updatedAt: 10 }] }, { 'sales:a': { acked: 10 }, 'sales:gone': rows[0] }).length, 0);
});
test('batching and backoff', () => {
  assert.deepEqual(batch(Array.from({ length: 120 }, (_, i) => i), 50).map(b => b.length), [50, 50, 20]);
  assert.equal(backoffMs(0), 5000); assert.equal(backoffMs(3), 40000); assert.equal(backoffMs(30), 900000);
});
test('merge: newest updatedAt wins, missing records are added', () => {
  const local = [{ id: 'a', updatedAt: 10 }, { id: 'b', updatedAt: 50 }];
  const remote = [{ id: 'a', updatedAt: 20 }, { id: 'b', updatedAt: 40 }, { id: 'c', updatedAt: 1 }];
  const m = mergeRecords('products', local, remote, 'merge');
  assert.deepEqual(m.write.map(r => r.id), ['a', 'c']); assert.equal(m.keptLocal, 1);
  assert.equal(mergeRecords('products', local, remote, 'replace').write.length, 3);
});
test('connection code round trip and validation', () => {
  const url = 'https://script.google.com/macros/s/AKfyc123/exec', code = encodeConnection(url, 'k3y-abcdef123456');
  assert.deepEqual(decodeConnection('  ' + code + '\n'), { url, key: 'k3y-abcdef123456' });
  assert.equal(decodeConnection('not a code'), null);
  assert.equal(decodeConnection(btoa(JSON.stringify({ u: 'http://x', k: 'abcdefgh1' }))), null);
});
test('red banner after more than 2 closed days with no sync or export', () => {
  assert.equal(backupOverdue([5, 6], 1, 0), false);
  assert.equal(backupOverdue([5, 6, 7], 1, 0), true);
  assert.equal(backupOverdue([5, 6, 7], 1, 6), false);   // export at 6 leaves only 1 day outstanding
});
test('chip text', () => {
  assert.equal(chipState({ connected: true, online: true, pending: 0 }).text, 'All backed up ✓');
  assert.equal(chipState({ connected: true, online: false, pending: 3 }).text, '3 waiting for signal');
  assert.equal(chipState({ connected: true, online: true, pending: 3, error: 'x' }).text, 'Sync error (tap)');
});
