import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureStopEvent } from '../lib/final-hook.mjs';
import { normalizeNativeResult } from '../lib/native.mjs';
import { fixture } from './helpers.mjs';

const result = value => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  isError: false,
});

function unrelatedRepository({ flow = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'relay-hook-unrelated-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Relay test');
  git('config', 'user.email', 'relay@example.test');
  writeFileSync(join(repo, 'value.txt'), 'unrelated');
  git('add', 'value.txt'); git('commit', '-m', 'baseline');
  const common = join(repo, '.git');
  if (flow) {
    mkdirSync(join(common, 'codex-flow'));
    writeFileSync(join(common, 'codex-flow', 'sentinel'), 'preserve');
  }
  return { repo, common };
}

test('Stop discovery does not initialize or alter unrelated and Flow-only repositories', () => {
  for (const flow of [false, true]) {
    const { repo, common } = unrelatedRepository({ flow });
    const before = readdirSync(common).sort();
    const observed = captureStopEvent({
      hook_event_name: 'Stop', session_id: 'foreign-task', turn_id: 'foreign-turn',
      stop_hook_active: false, cwd: repo, last_assistant_message: 'Foreign final',
    });
    assert.equal(observed.reason, 'relay-sender-unbound');
    assert.equal(existsSync(join(common, 'relay')), false);
    assert.deepEqual(readdirSync(common).sort(), before);
    if (flow) assert.equal(readFileSync(join(common, 'codex-flow', 'sentinel'), 'utf8'), 'preserve');
  }
});

test('purpose-built task results bind ready/provisional identities without inferred success', () => {
  assert.deepEqual(normalizeNativeResult({
    kind: 'create', actionId: 'action',
    result: result({ clientThreadId: 'client', hostId: 'host' }),
  }), {
    actionId: 'action', status: 'provisional', clientThreadId: 'client',
    hostId: 'host', nativeResultDigest: normalizeNativeResult({
      kind: 'create', actionId: 'action', result: result({ clientThreadId: 'client', hostId: 'host' }),
    }).nativeResultDigest,
  });
  assert.equal(normalizeNativeResult({
    kind: 'create', actionId: 'action', result: { content: [{ type: 'text', text: 'queued' }] },
  }).status, 'ambiguous');

  const f = fixture();
  const prepared = f.relay.prepare({ ...f.spec, recipientHostId: 'director-host' }, 'director');
  const bound = f.relay.recordNativeResult(prepared.assignment, 'director', prepared.nativeAction.id,
    result({ threadId: 'coordinator', hostId: 'coordinator-host' }));
  assert.equal(bound.status, 'BOUND');
  const control = f.relay.store.control();
  const record = f.relay.store.assignment(control, prepared.assignment);
  assert.equal(record.task, 'coordinator');
  assert.equal(record.taskHostId, 'coordinator-host');
  assert.equal(record.recipientHostId, 'director-host');
  assert.equal(prepared.nativeAction.tool, 'mcp__codex_app__create_thread');
});

test('Stop adapter captures the genuine released final identity and exact bytes once', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  const event = {
    hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'turn-final',
    stop_hook_active: false, cwd: f.repo,
    last_assistant_message: 'Exact final bytes\nwith Unicode: 雪',
  };
  assert.equal(captureStopEvent(event).reason, 'source-result-unsealed');
  f.commit('src/value.txt', 'finished');
  f.relay.finish(ready.ticket, 'coordinator');
  const captured = captureStopEvent(event);
  assert.equal(captured.status, 'captured');
  assert.equal(captured.eventId, 'turn-final');
  assert.equal(f.relay.status(prepared.assignment).report.final.text, event.last_assistant_message);
  assert.deepEqual(captureStopEvent(event), captured);
  assert.throws(() => captureStopEvent({ ...event, last_assistant_message: 'conflicting bytes' }), /conflict/);
  assert.equal(captureStopEvent({ ...event, session_id: 'foreign-task' }).reason, 'relay-sender-unbound');
  assert.equal(captureStopEvent({ ...event, stop_hook_active: true }).reason, 'unsupported-stop-event');
});

test('hook executable requests one advisory continuation while preserving exact final', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  f.relay.finish(ready.ticket, 'coordinator');
  const event = {
    hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'turn-cli',
    stop_hook_active: false, cwd: f.repo, last_assistant_message: 'CLI hook final',
  };
  const hook = fileURLToPath(new URL('../bin/relay-final-hook.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [hook], { input: JSON.stringify(event), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).decision, 'block');
  const repeated = spawnSync(process.execPath, [hook], { input: JSON.stringify(event), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(repeated.stdout), {});
  assert.equal(f.relay.status(prepared.assignment).report.final.eventId, 'turn-cli');
});

test('report delivery requires purpose-built queue observation and recipient delivery key', () => {
  const f = fixture();
  const prepared = f.relay.prepare({ ...f.spec, recipientHostId: 'director-host' }, 'director');
  f.relay.recordNativeResult(prepared.assignment, 'director', prepared.nativeAction.id,
    result({ threadId: 'coordinator', hostId: 'coordinator-host' }));
  const ready = f.relay.start(prepared.ticket, 'coordinator');
  f.relay.finish(ready.ticket, 'coordinator');
  captureStopEvent({
    hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'turn-report',
    stop_hook_active: false, cwd: f.repo, last_assistant_message: 'Native final data',
  });
  const submission = f.relay.report('submit', prepared.assignment, 'coordinator');
  assert.equal(submission.nativeAction.tool, 'mcp__codex_app__send_message_to_thread');
  assert.equal(submission.nativeAction.args.threadId, 'director');
  assert.equal(submission.nativeAction.args.hostId, 'director-host');
  assert.match(submission.nativeAction.args.prompt, /Native final data/);
  assert.match(submission.nativeAction.args.prompt, new RegExp(submission.request.id));
  assert.throws(() => f.relay.report('receive', prepared.assignment, 'director', { deliveryKey: 'wrong' }), /exact delivered/);
  const queued = f.relay.recordNativeResult(prepared.assignment, 'coordinator', submission.nativeAction.id,
    result({ threadId: 'director' }));
  assert.equal(queued.status, 'QUEUED');
  assert.equal(f.relay.status(prepared.assignment).report.receipt, null);
  f.relay.report('receive', prepared.assignment, 'director', {
    deliveryKey: submission.request.id, decision: 'accepted',
  });
  assert.equal(f.relay.status(prepared.assignment).report.receipt.deliveryKey, submission.request.id);
});

test('native wait remains notification while shared report receipt needs no sender reactivation', () => {
  const f = fixture();
  const prepared = f.relay.prepare({ ...f.spec, recipientHostId: 'director-host' }, 'director');
  f.relay.recordNativeResult(prepared.assignment, 'director', prepared.nativeAction.id,
    result({ threadId: 'coordinator', hostId: 'coordinator-host' }));
  const ready = f.relay.start(prepared.ticket, 'coordinator');
  f.relay.finish(ready.ticket, 'coordinator');
  const finalText = 'Final returned by wait_threads';
  captureStopEvent({
    hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'turn-wait',
    stop_hook_active: false, cwd: f.repo, last_assistant_message: finalText,
  });

  const receipt = f.relay.report('prepare-receipt', prepared.assignment, 'director');
  assert.equal(receipt.nativeAction.tool, 'mcp__codex_app__wait_threads');
  assert.deepEqual(receipt.nativeAction.args, {
    targets: [{ threadId: 'coordinator', hostId: 'coordinator-host' }], timeoutMs: 0,
  });
  const pending = f.relay.recordNativeResult(prepared.assignment, 'director', receipt.nativeAction.id,
    result({ polls: [{ schemaVersion: 1, cursor: 'cursor-1', thread: { id: 'coordinator', hostId: 'coordinator-host' }, latestTurn: { id: 'turn-wait', status: 'completed', error: null }, latestAssistantMessageId: null, latestAssistantMessage: null }] }));
  assert.equal(pending.status, 'NOTIFICATION_PENDING');
  assert.match(pending.nextAction, / read-report /);
  assert.equal(pending.nativeAction.args.targets[0].afterCursor, undefined);
  assert.equal(f.relay.status(prepared.assignment).report.receipt, null);

  const message = (overrides = {}) => ({
    id: 'msg-final', turnId: 'turn-wait', phase: 'final_answer', text: finalText, ...overrides,
  });
  const poll = (latestAssistantMessage, overrides = {}) => ({
    schemaVersion: 1, cursor: 'cursor-2', revision: 2, changed: true,
    thread: { id: 'coordinator', hostId: 'coordinator-host', status: { type: 'idle' } },
    latestTurn: { id: 'turn-wait', status: 'completed', error: null },
    latestAssistantMessageId: latestAssistantMessage?.id ?? null,
    latestAssistantMessage,
    ...overrides,
  });
  for (const rejected of [
    result({ polls: [poll(finalText)] }),
    result({ polls: [poll(message({ phase: 'commentary' }))] }),
    result({ polls: [poll(message({ turnId: 'wrong-turn' }))] }),
    result({ polls: [poll(message(), { latestAssistantMessageId: 'msg-conflict' })] }),
    result({ polls: [poll(message(), { latestTurn: { id: 'turn-wait', status: 'completed', error: { message: 'native failure' } } })] }),
    { ...result({ polls: [poll(message())] }), isError: true },
    { content: [
      { type: 'text', text: JSON.stringify({ polls: [poll(message())] }) },
      { type: 'text', text: JSON.stringify({ polls: [poll(message({ id: 'msg-conflict', phase: 'commentary' }))] }) },
    ], isError: false },
  ]) {
    const refused = f.relay.recordNativeResult(prepared.assignment, 'director', receipt.nativeAction.id, rejected);
    assert.equal(refused.status, 'NOTIFICATION_PENDING');
    assert.equal(refused.nativeAction.args.targets[0].afterCursor, undefined);
  }

  const received = f.relay.recordNativeResult(prepared.assignment, 'director', receipt.nativeAction.id,
    result({ polls: [poll(message())] }));
  assert.equal(received.status, 'NOTIFIED');
  assert.equal(f.relay.status(prepared.assignment).report.receipt, null);
  const read = f.relay.readReport(prepared.assignment, 'director');
  f.relay.report('acknowledge', prepared.assignment, 'director', read.acknowledgement);
  f.relay.report('accept', prepared.assignment, 'director');
  const stored = f.relay.status(prepared.assignment).report.receipt;
  assert.equal(stored.transport, 'shared-storage');
  assert.equal(f.relay.status(prepared.assignment).report.nativeReceipt.status, 'notified');
  assert.equal(f.relay.status(prepared.assignment).report.submission, null);
});

test('archive result stays ambiguous until exact affirmative observation and never prepares a retry', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  f.relay.finish(ready.ticket, 'coordinator');
  captureStopEvent({
    hook_event_name: 'Stop', session_id: 'coordinator', turn_id: 'turn-archive',
    stop_hook_active: false, cwd: f.repo, last_assistant_message: 'Archive final',
  });
  const submission = f.relay.report('submit', prepared.assignment, 'coordinator');
  f.relay.recordNativeResult(prepared.assignment, 'coordinator', submission.nativeAction.id, result({ threadId: 'director' }));
  f.relay.report('receive', prepared.assignment, 'director', { deliveryKey: submission.request.id, decision: 'accepted' });
  const archive = f.relay.report('retire', prepared.assignment, 'director');
  assert.equal(archive.nativeAction.tool, 'mcp__codex_app__set_thread_archived');
  assert.equal(archive.observationAction.tool, 'mcp__codex_app__list_archived_threads');
  const ambiguous = f.relay.recordNativeResult(prepared.assignment, 'director', archive.nativeAction.id,
    result({ threadId: 'coordinator' }));
  assert.equal(ambiguous.status, 'ARCHIVE_PENDING');
  assert.equal(f.relay.report('retire', prepared.assignment, 'director').nativeAction, undefined);
  const archived = f.relay.recordNativeResult(prepared.assignment, 'director', archive.nativeAction.id,
    result({ threads: [{ threadId: 'coordinator', title: 'task' }] }));
  assert.equal(archived.status, 'RETIRED');
});
