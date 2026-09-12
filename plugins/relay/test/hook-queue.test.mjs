import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { homedir } from 'node:os';
import { processStopEvent, captureStopEvent } from '../lib/final-hook.mjs';
import { submitQueueNotification, QUEUE_VERSION } from '../lib/queue-notification.mjs';
import { fixture } from './helpers.mjs';

function released() {
  const f = fixture(), { prepared, ready } = f.start();
  f.relay.finish(ready.ticket, 'coordinator');
  return { ...f, id: prepared.assignment, event: { hook_event_name: 'Stop', session_id: 'coordinator',
    turn_id: 'final', cwd: f.repo, stop_hook_active: false, last_assistant_message: 'Genuine final 雪' } };
}
test('new hook captures once outside lock, preserves concurrent review, and never continues worker', async () => {
  const f = released(); let calls = 0;
  const submit = async request => {
    calls++;
    assert.equal(request.recipient, 'director');
    assert.doesNotMatch(request.text, /Genuine final/);
    assert.equal(existsSync(join(f.relay.store.root, 'transition.lock')), false);
    const read = f.relay.readReport(f.id, 'director');
    f.relay.report('acknowledge', f.id, 'director', read.acknowledgement);
    f.relay.report('accept', f.id, 'director');
    const duplicate = await processStopEvent(f.event, { submit });
    assert.equal(duplicate.notification, undefined);
    return { status: 'queued', reason: 'exact-queue-response' };
  };
  const result = await processStopEvent(f.event, { submit });
  assert.equal(calls, 1); assert.equal(result.hookOutput, undefined);
  assert.equal(f.relay.status(f.id).decision, 'accepted');
  assert.equal(f.relay.status(f.id).report.notification.status, 'queued');
  assert.equal(f.relay.report('retire', f.id, 'director').status, 'SENDER_IDLE_REQUIRED');
  assert.throws(() => f.relay.report('submit', f.id, 'coordinator'), /cannot resend/);
  await processStopEvent({ ...f.event, stop_hook_active: true, turn_id: 'other' }, { submit });
  assert.equal(calls, 1);
});
test('transport failure and capture-before-send crash retain final without retry', async () => {
  const f = released(); let calls = 0;
  const submit = async () => { calls++; throw Error('failure'); };
  const result = await processStopEvent(f.event, { submit });
  assert.equal(result.notificationOutcome.status, 'ambiguous');
  await processStopEvent(f.event, { submit }); assert.equal(calls, 1);
  assert.equal(f.relay.readReport(f.id, 'director').report.text, f.event.last_assistant_message);
  const crash = released(); captureStopEvent(crash.event, { notify: true });
  await processStopEvent(crash.event, { submit }); assert.equal(calls, 1);
  assert.equal(crash.relay.status(crash.id).report.notification.reason, 'attempt-persisted');
});
test('unsealed intermediate stop is not completion', async () => {
  const f = fixture(); f.start();
  const result = await processStopEvent({ hook_event_name: 'Stop', session_id: 'coordinator',
    turn_id: 'question', cwd: f.repo, last_assistant_message: 'Need clarification' },
  { submit: () => { throw Error('must not send'); } });
  assert.equal(result.reason, 'source-result-unsealed');
});

const request = { id: '11111111-1111-4111-8111-111111111111', recipient: '22222222-2222-4222-8222-222222222222',
  hostId: 'local', senderHostId: 'local', text: 'Frozen report available 雪' };
function transport({ version = QUEUE_VERSION, queue = 'exact', silent = false, noClose = false, badAgent = false } = {}) {
  const sent = [], child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let closed = false;
  child.kill = () => { if (!closed && !noClose) { closed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); } return true; };
  child.stdin.on('data', bytes => {
    const value = JSON.parse(bytes); sent.push(value);
    if (silent) return;
    const reply = value.id === 1 ? { id: 1, result: { codexHome: join(homedir(), '.codex'), userAgent: badAgent ? {} : `Codex Desktop/${version} (test)` } }
      : value.id === 2 ? { id: 2, result: { queuedSubmission: { id: request.id,
        clientUserMessageId: queue === 'wrong' ? 'wrong' : request.id, input: queue === 'null' ? [null] : [{ type: 'text', text: request.text }] } } } : null;
    if (reply) setImmediate(() => child.stdout.write(JSON.stringify(reply) + '\n'));
  });
  return { sent, spawnProcess: () => child };
}
test('queue adapter bounds process, exact response, host and version; never resumes tasks', async () => {
  for (const [options, status] of [[{}, 'queued'], [{ version: 'changed' }, 'ambiguous'], [{ queue: 'wrong' }, 'ambiguous'], [{ silent: true }, 'ambiguous'], [{ noClose: true }, 'ambiguous'], [{ badAgent: true }, 'ambiguous'], [{ queue: 'null' }, 'ambiguous']]) {
    const f = transport(options);
    const result = await submitQueueNotification(request, { ...f, deadlineMs: 30, cleanupMs: 10 });
    assert.equal(result.status, status);
    assert.ok(f.sent.every(value => ['initialize', 'initialized', 'thread/queue/add'].includes(value.method)));
    assert.ok(f.sent.filter(value => value.method === 'thread/queue/add').length <= 1);
  }
  const wrongHost = await submitQueueNotification({ ...request, hostId: 'remote' }, { spawnProcess: () => { throw Error('must not spawn'); } });
  assert.equal(wrongHost.reason, 'unsupported-host');
  assert.equal((await submitQueueNotification(request, { spawnProcess: () => { throw Error('missing'); } })).reason, 'transport-unavailable');
});
