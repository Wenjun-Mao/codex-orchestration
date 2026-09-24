import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { homedir } from 'node:os';
import { submitQueueNotification } from '../lib/queue-notification.mjs';
const request = { id: '11111111-1111-4111-8111-111111111111', recipient: '22222222-2222-4222-8222-222222222222',
  sender: '33333333-3333-4333-8333-333333333333',
  hostId: 'local', senderHostId: 'local', text: 'Exact final 雪\n'.repeat(5000) };
function transport({ version = '0.154.0-alpha.6.2', queue = 'exact', silent = false, noClose = false, badAgent = false, wrongHome = false, queueError = false, name = 'Actual task title', readError = false, wrongSender = false, stalledTitle = false, lateTitle = false, closeOnTitle = false, silentQueue = false } = {}) {
  const sent = [], child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let closed = false;
  child.kill = () => { if (!closed && !noClose) { closed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); } return true; };
  child.stdin.on('data', bytes => {
    const value = JSON.parse(bytes); sent.push(value);
    if (silent) return;
    if (value.id === 3 && closeOnTitle) { child.kill(); return; }
    if (value.id === 2 && silentQueue) return;
    if (value.id === 3 && (stalledTitle || lateTitle)) return;
    if (value.id === 2 && lateTitle) setImmediate(() => child.stdout.write(JSON.stringify({ id: 3,
      result: { thread: { id: request.sender, name: 'Late title must not resend' } } }) + '\n'));
    const reply = value.id === 1 ? { id: 1, result: { codexHome: wrongHome ? '/other-account' : join(homedir(), '.codex'), userAgent: badAgent ? {} : `Codex Desktop/${version} (test)` } }
      : value.id === 3 ? (readError ? { id: 3, error: { message: 'unavailable' } } : { id: 3, result: { thread: { id: wrongSender ? 'foreign' : request.sender, name } } })
      : value.id === 2 ? (queueError ? { id: 2, error: { code: -32601, message: 'Method not found' } } : { id: 2, result: { queuedSubmission: { id: request.id,
        clientUserMessageId: queue === 'wrong' ? 'wrong' : request.id, input: queue === 'null' ? [null] : queue === 'changed-text' ? [{ type: 'text', text: 'altered' }] : value.params.input } } }) : null;
    if (reply) setImmediate(() => child.stdout.write(JSON.stringify(reply) + '\n'));
  });
  return { sent, spawnProcess: () => child };
}
test('queue adapter accepts compatible updates and bounds exact response and host; never resumes tasks', async () => {
  for (const [options, status] of [[{}, 'queued'], [{ version: '0.155.0-alpha.9' }, 'queued'], [{ version: '99.0.0' }, 'queued'], [{ wrongHome: true }, 'ambiguous'], [{ queueError: true }, 'ambiguous'], [{ queue: 'changed-text' }, 'ambiguous'], [{ queue: 'wrong' }, 'ambiguous'], [{ silent: true }, 'ambiguous'], [{ noClose: true }, 'queued'], [{ badAgent: true }, 'ambiguous'], [{ queue: 'null' }, 'ambiguous']]) {
    const f = transport(options);
    const result = await submitQueueNotification(request, { ...f, deadlineMs: 30, cleanupMs: 10 });
    assert.equal(result.status, status);
    assert.ok(f.sent.every(value => ['initialize', 'initialized', 'thread/read', 'thread/queue/add'].includes(value.method)));
    assert.ok(f.sent.filter(value => value.method === 'thread/queue/add').length <= 1);
    if (options.wrongHome || options.badAgent) assert.equal(f.sent.some(value => value.method === 'thread/queue/add'), false);
  }
  const wrongHost = await submitQueueNotification({ ...request, hostId: 'remote' }, { spawnProcess: () => { throw Error('must not spawn'); } });
  assert.equal(wrongHost.reason, 'unsupported-host');
  assert.equal((await submitQueueNotification(request, { spawnProcess: () => { throw Error('missing'); } })).reason, 'transport-unavailable');
});

test('optional title timeout falls back before queueing once and ignores late metadata', async () => {
  for (const options of [{ stalledTitle: true }, { lateTitle: true }]) {
    const f = transport(options);
    const outcome = await submitQueueNotification(request, { ...f, titleLookupMs: 5, deadlineMs: 1000 });
    assert.equal(outcome.status, 'queued');
    const messages = f.sent.filter(value => value.method === 'thread/queue/add');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].params.input[0].text, `From: ${request.sender}\n\n${request.text}`);
  }
});

test('helper cleanup uncertainty preserves both exact acknowledgement and original send failure', async () => {
  for (const queueError of [false, true]) {
    const f = transport({ noClose: true, queueError });
    const outcome = await submitQueueNotification(request, { ...f, deadlineMs: 1000, cleanupMs: 5 });
    assert.equal(outcome.status, queueError ? 'ambiguous' : 'queued');
    assert.equal(outcome.reason, queueError ? 'queue-response-unconfirmed' : 'exact-queue-response');
    assert.equal(outcome.cleanupWarning, 'transport-cleanup-unconfirmed');
    assert.equal(f.sent.filter(value => value.method === 'thread/queue/add').length, 1);
  }
});

test('title fallback neither sends after closure nor retries an unacknowledged queue request', async () => {
  const closed = transport({ closeOnTitle: true });
  const result = await submitQueueNotification(request, { ...closed, titleLookupMs: 5, deadlineMs: 1000 });
  assert.equal(result.reason, 'transport-closed');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closed.sent.some(value => value.method === 'thread/queue/add'), false);
  const silent = transport({ stalledTitle: true, silentQueue: true });
  const timeout = await submitQueueNotification(request, { ...silent, titleLookupMs: 5, deadlineMs: 100 });
  assert.equal(timeout.reason, 'transport-timeout');
  assert.equal(silent.sent.filter(value => value.method === 'thread/queue/add').length, 1);
});

test('one current-title attribution line precedes an unchanged body; missing titles use sender ID', async () => {
  for (const [options, label] of [
    [{ name: 'Renamed task · 雪' }, 'Renamed task · 雪'],
    [{ name: 'First\nSecond' }, 'First Second'],
    [{ name: null }, request.sender], [{ readError: true }, request.sender],
    [{ wrongSender: true }, request.sender],
  ]) {
    const f = transport(options);
    const outcome = await submitQueueNotification(request, { ...f, deadlineMs: 1000 });
    assert.equal(outcome.status, 'queued');
    const read = f.sent.filter(value => value.method === 'thread/read');
    assert.deepEqual(read.map(value => value.params), [{ threadId: request.sender, includeTurns: false }]);
    const messages = f.sent.filter(value => value.method === 'thread/queue/add');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].params.input[0].text, `From: ${label}\n\n${request.text}`);
  }
});
