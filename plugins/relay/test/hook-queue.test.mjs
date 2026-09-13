import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { homedir } from 'node:os';
import { processStopEvent, captureStopEvent } from '../lib/final-hook.mjs';
import { submitQueueNotification, QUEUE_VERSION } from '../lib/queue-notification.mjs';
import { fixture, cliProcess } from './helpers.mjs';

function released() {
  const f = fixture(), { prepared, ready } = f.start();
  f.relay.finish(ready.ticket, 'coordinator');
  return { ...f, id: prepared.assignment, event: { hook_event_name: 'Stop', session_id: 'coordinator',
    turn_id: 'final', cwd: f.repo, stop_hook_active: false, last_assistant_message: 'Genuine final 雪' } };
}
test('hook forwards exact final text without writing any Relay state or blocking worker', async () => {
  const f = released();
  const before = directoryBytes(f.relay.store.root);
  const requests = [];
  const submit = async request => {
    requests.push(request);
    assert.equal(request.recipient, 'director');
    assert.equal(request.text, f.event.last_assistant_message);
    assert.equal(existsSync(join(f.relay.store.root, 'transition.lock')), false);
    return { status: 'queued', reason: 'exact-queue-response' };
  };
  const result = await processStopEvent(f.event, { submit });
  assert.equal(result.status, 'queued');
  assert.equal(result.hookOutput, undefined);
  assert.deepEqual(directoryBytes(f.relay.store.root), before);
  await processStopEvent(f.event, { submit });
  assert.equal(requests[0].id, requests[1].id);
  await processStopEvent({ ...f.event, stop_hook_active: true }, { submit });
  assert.equal(requests.length, 2);
  f.relay.report('accept', f.id, 'director');
  assert.equal(f.relay.report('retire', f.id, 'director').status, 'SENDER_IDLE_REQUIRED');
});
test('unsealed and failed workers send unchanged text, without source permission changes', async () => {
  const f = fixture();
  f.spec.checks = [[process.execPath, '-e', 'process.exit(1)']];
  const { prepared, ready } = f.start();
  assert.throws(() => f.relay.finish(ready.ticket, 'coordinator'), /Check failed/);
  const before = directoryBytes(f.relay.store.root);
  const event = { hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'failed',
    cwd: f.repo, last_assistant_message: 'My actual output\n雪\n' };
  let calls = 0;
  const result = await processStopEvent(event, { submit: async request => {
    calls++; assert.equal(request.text, event.last_assistant_message);
    throw Error('transport unavailable');
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(directoryBytes(f.relay.store.root), before);
  assert.throws(() => f.relay.report('accept', prepared.assignment, 'director'), /Unverified/);
  assert.throws(() => f.relay.report('retire', prepared.assignment, 'director'), /source owner/);
});
test('routing works with old assignments, ignores unbound tasks and archived senders', () => {
  const f = released();
  const before = captureStopEvent(f.event);
  f.relay.store.locked(control => {
    const record = f.relay.record(control, f.id);
    record.report.notificationMode = 'advisory-once';
    f.relay.store.commit(control, [record]);
  });
  assert.deepEqual(captureStopEvent(f.event), before);
  assert.equal(captureStopEvent({ ...f.event, session_id: 'other' }).reason, 'relay-sender-unbound');
  f.relay.store.locked(control => {
    const record = f.relay.record(control, f.id);
    record.archive = { status: 'archived' };
    f.relay.store.commit(control, [record]);
  });
  assert.equal(captureStopEvent(f.event).reason, 'relay-route-inactive');
});
function directoryBytes(path) {
  return readdirSync(path).sort().map(name => {
    const file = join(path, name);
    return [name, statSync(file).isDirectory() ? directoryBytes(file) : readFileSync(file).toString('hex')];
  });
}

const request = { id: '11111111-1111-4111-8111-111111111111', recipient: '22222222-2222-4222-8222-222222222222',
  sender: '33333333-3333-4333-8333-333333333333',
  hostId: 'local', senderHostId: 'local', text: 'Exact final 雪\n'.repeat(5000) };
function transport({ version = QUEUE_VERSION, queue = 'exact', silent = false, noClose = false, badAgent = false, name = 'Actual task title', readError = false, wrongSender = false } = {}) {
  const sent = [], child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let closed = false;
  child.kill = () => { if (!closed && !noClose) { closed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); } return true; };
  child.stdin.on('data', bytes => {
    const value = JSON.parse(bytes); sent.push(value);
    if (silent) return;
    const reply = value.id === 1 ? { id: 1, result: { codexHome: join(homedir(), '.codex'), userAgent: badAgent ? {} : `Codex Desktop/${version} (test)` } }
      : value.id === 3 ? (readError ? { id: 3, error: { message: 'unavailable' } } : { id: 3, result: { thread: { id: wrongSender ? 'foreign' : request.sender, name } } })
      : value.id === 2 ? { id: 2, result: { queuedSubmission: { id: request.id,
        clientUserMessageId: queue === 'wrong' ? 'wrong' : request.id, input: queue === 'null' ? [null] : value.params.input } } } : null;
    if (reply) setImmediate(() => child.stdout.write(JSON.stringify(reply) + '\n'));
  });
  return { sent, spawnProcess: () => child };
}
test('queue adapter bounds process, exact response, host and version; never resumes tasks', async () => {
  for (const [options, status] of [[{}, 'queued'], [{ version: 'changed' }, 'ambiguous'], [{ queue: 'wrong' }, 'ambiguous'], [{ silent: true }, 'ambiguous'], [{ noClose: true }, 'ambiguous'], [{ badAgent: true }, 'ambiguous'], [{ queue: 'null' }, 'ambiguous']]) {
    const f = transport(options);
    const result = await submitQueueNotification(request, { ...f, deadlineMs: 30, cleanupMs: 10 });
    assert.equal(result.status, status);
    assert.ok(f.sent.every(value => ['initialize', 'initialized', 'thread/read', 'thread/queue/add'].includes(value.method)));
    assert.ok(f.sent.filter(value => value.method === 'thread/queue/add').length <= 1);
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
