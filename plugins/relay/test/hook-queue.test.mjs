import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
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
test('unsealed stops notify once per turn without granting acceptance, then later finish reports normally', async () => {
  const f = fixture(); const { prepared, ready } = f.start();
  const permission = structuredClone(f.relay.store.control().permission);
  const event = { hook_event_name: 'Stop', session_id: 'coordinator',
    turn_id: 'question', cwd: f.repo, last_assistant_message: 'Need clarification' };
  let calls = 0;
  const submit = async request => {
    calls++; assert.match(request.text, /not completion or acceptance/);
    assert.equal(existsSync(join(f.relay.store.root, 'transition.lock')), false);
    return { status: 'queued', reason: 'exact-queue-response' };
  };
  await processStopEvent(event, { submit });
  await processStopEvent(event, { submit });
  assert.equal(calls, 1);
  const read = f.relay.readReport(prepared.assignment, 'director', 'question');
  assert.equal(read.report.text, 'Need clarification');
  assert.equal(read.report.systemStatus.resultSealed, false);
  const cli = cliProcess(f.repo, 'read-report', { assignment: prepared.assignment, actor: 'director', 'event-id': 'question' });
  assert.equal(cli.status, 0);
  assert.equal(JSON.parse(cli.stdout).report.text, event.last_assistant_message);
  assert.throws(() => f.relay.readReport(prepared.assignment, 'foreign', 'question'), /recipient/);
  assert.throws(() => f.relay.report('accept', prepared.assignment, 'director'));
  assert.throws(() => f.relay.report('retire', prepared.assignment, 'director'));
  assert.deepEqual(f.relay.store.control().permission, permission);
  f.relay.finish(ready.ticket, 'coordinator');
  await processStopEvent(event, { submit }); // delayed old turn cannot become final
  assert.equal(f.relay.status(prepared.assignment).report.final, null);
  await processStopEvent({ ...event, turn_id: 'complete', last_assistant_message: 'Done' },
    { submit: async () => ({ status: 'queued', reason: 'exact-queue-response' }) });
  assert.equal(f.relay.readReport(prepared.assignment, 'director').report.text, 'Done');
});
test('verification failure is persisted separately from an inaccurate worker success claim', async () => {
  const f = fixture(); f.spec.checks = [[process.execPath, '-e', 'process.exit(1)']];
  const { prepared, ready } = f.start();
  const before = structuredClone(f.relay.store.control().permission);
  assert.throws(() => f.relay.finish(ready.ticket, 'coordinator'), /Check failed/);
  const event = { hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'failed', cwd: f.repo, last_assistant_message: 'Everything succeeded' };
  let sent;
  await processStopEvent(event, { submit: async request => { sent = request; return { status: 'ambiguous', reason: 'transport-unavailable' }; } });
  assert.match(sent.text, /verification failed \(check-failed\)/);
  const read = f.relay.readReport(prepared.assignment, 'director', 'failed');
  assert.equal(read.report.text, 'Everything succeeded');
  assert.equal(read.report.systemStatus.verification.status, 'failed');
  assert.equal(read.report.notification.status, 'ambiguous');
  assert.deepEqual(f.relay.store.control().permission, before);
  assert.equal(f.relay.status(prepared.assignment).report.association, null);
  await processStopEvent(event, { submit: () => { throw Error('no retry'); } });
});
test('verification mutation diagnostics name changed fields without leaking command output', async () => {
  const f = fixture(); f.spec.checks = [[process.execPath, '-e', 'require("fs").writeFileSync("diagnostic.txt", "secret"); console.log("secret")']];
  const { prepared, ready } = f.start();
  assert.throws(() => f.relay.finish(ready.ticket, 'coordinator'), /Verification changed/);
  const event = { hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'mutation', cwd: f.repo, last_assistant_message: 'Stopped' };
  await processStopEvent(event, { submit: async request => { assert.doesNotMatch(request.text, /secret/); return { status: 'queued', reason: 'exact-queue-response' }; } });
  const read = f.relay.readReport(prepared.assignment, 'director', 'mutation');
  assert.ok(read.report.systemStatus.verification.changedFields.includes('untracked'));
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
