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
function transport({ version = '0.154.0-alpha.6.2', queue = 'exact', silent = false, noClose = false, badAgent = false, wrongHome = false, queueError = false, name = 'Actual task title', readError = false, wrongSender = false } = {}) {
  const sent = [], child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let closed = false;
  child.kill = () => { if (!closed && !noClose) { closed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); } return true; };
  child.stdin.on('data', bytes => {
    const value = JSON.parse(bytes); sent.push(value);
    if (silent) return;
    const reply = value.id === 1 ? { id: 1, result: { codexHome: wrongHome ? '/other-account' : join(homedir(), '.codex'), userAgent: badAgent ? {} : `Codex Desktop/${version} (test)` } }
      : value.id === 3 ? (readError ? { id: 3, error: { message: 'unavailable' } } : { id: 3, result: { thread: { id: wrongSender ? 'foreign' : request.sender, name } } })
      : value.id === 2 ? (queueError ? { id: 2, error: { code: -32601, message: 'Method not found' } } : { id: 2, result: { queuedSubmission: { id: request.id,
        clientUserMessageId: queue === 'wrong' ? 'wrong' : request.id, input: queue === 'null' ? [null] : queue === 'changed-text' ? [{ type: 'text', text: 'altered' }] : value.params.input } } }) : null;
    if (reply) setImmediate(() => child.stdout.write(JSON.stringify(reply) + '\n'));
  });
  return { sent, spawnProcess: () => child };
}
test('queue adapter accepts compatible updates and bounds exact response and host; never resumes tasks', async () => {
  for (const [options, status] of [[{}, 'queued'], [{ version: '0.155.0-alpha.9' }, 'queued'], [{ version: '99.0.0' }, 'queued'], [{ wrongHome: true }, 'ambiguous'], [{ queueError: true }, 'ambiguous'], [{ queue: 'changed-text' }, 'ambiguous'], [{ queue: 'wrong' }, 'ambiguous'], [{ silent: true }, 'ambiguous'], [{ noClose: true }, 'ambiguous'], [{ badAgent: true }, 'ambiguous'], [{ queue: 'null' }, 'ambiguous']]) {
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
