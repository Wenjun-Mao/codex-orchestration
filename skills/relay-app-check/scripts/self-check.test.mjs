import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { selfCheck } from './self-check.mjs';

const threadId = '11111111-1111-4111-8111-111111111111';
const env = { CODEX_THREAD_ID: threadId };
function fixture(t, name = 'relay') {
  const root = mkdtempSync(join(tmpdir(), 'relay-app-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.codex-plugin'));
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, '.codex-plugin/plugin.json'), JSON.stringify({ name, version: '0.4.2+fixture' }));
  writeFileSync(join(root, 'lib/queue-notification.mjs'), '');
  return root;
}

test('dry-run constructs a unique Unicode self-message without loading transport', async t => {
  const pluginRoot = fixture(t);
  const options = { pluginRoot, env, dryRun: true, loadTransport: () => assert.fail('must not load') };
  const first = await selfCheck(options), second = await selfCheck(options);
  assert.notEqual(first.request.id, second.request.id);
  assert.equal(first.request.sender, threadId);
  assert.equal(first.request.recipient, threadId);
  assert.ok(first.request.text.includes(first.request.id));
  assert.ok(first.request.text.includes('exact text, 雪. No action needed.'));
  assert.equal(first.transport.status, 'not-exercised');
  assert.equal(first.recipientReceipt, 'not-observed');
  assert.equal(first.genuineStopHook, 'not-exercised');
});

test('missing identity and wrong plugin are rejected before loading transport', async t => {
  const loadTransport = () => assert.fail('must not load');
  await assert.rejects(selfCheck({ pluginRoot: fixture(t), env: {}, loadTransport }), /CODEX_THREAD_ID/);
  await assert.rejects(selfCheck({ pluginRoot: fixture(t, 'other'), env, loadTransport }), /identify Relay/);
});

test('installed transport is called once and acknowledgement does not imply receipt', async t => {
  const pluginRoot = fixture(t);
  let sends = 0;
  const result = await selfCheck({ pluginRoot, env, loadTransport: async url => {
    assert.equal(url, pathToFileURL(realpathSync(join(pluginRoot, 'lib/queue-notification.mjs'))).href);
    return { submitQueueNotification: async request => {
      sends++;
      assert.equal(request.sender, request.recipient);
      assert.equal(request.hostId, 'local');
      return { status: 'queued', reason: 'exact-queue-response', cleanupWarning: 'fixture-warning' };
    } };
  } });
  assert.equal(sends, 1);
  assert.equal(result.transport.cleanupWarning, 'fixture-warning');
  assert.equal(result.recipientReceipt, 'not-observed');
  assert.equal(result.genuineStopHook, 'not-exercised');
});

test('ambiguous send is returned without retry', async t => {
  let sends = 0;
  const result = await selfCheck({ pluginRoot: fixture(t), env, loadTransport: async () => ({
    submitQueueNotification: async () => { sends++; return { status: 'ambiguous', reason: 'fixture-timeout' }; },
  }) });
  assert.equal(sends, 1);
  assert.deepEqual(result.transport, { status: 'ambiguous', reason: 'fixture-timeout' });
});

test('throw after transport invocation stays ambiguous without retry', async t => {
  let sends = 0;
  const result = await selfCheck({ pluginRoot: fixture(t), env, loadTransport: async () => ({
    submitQueueNotification: async () => { sends++; throw new Error('unknown send state'); },
  }) });
  assert.equal(sends, 1);
  assert.deepEqual(result.transport, {
    status: 'ambiguous', reason: 'transport-threw', error: 'unknown send state',
  });
});
