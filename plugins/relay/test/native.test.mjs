import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

test('archive result stays ambiguous until exact affirmative observation and never prepares a retry', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  f.relay.finish(ready.ticket, 'coordinator');
  f.relay.report('accept', prepared.assignment, 'director');
  const idle = f.relay.report('retire', prepared.assignment, 'director');
  const archiveAction = f.relay.recordNativeResult(prepared.assignment, 'director', idle.nativeAction.id, result({ polls: [{
    schemaVersion: 1, thread: { id: 'coordinator', status: { type: 'idle' } },
    latestTurn: { id: 'final', status: 'completed', error: null },
  }] }));
  assert.equal(archiveAction.nativeAction.tool, 'mcp__codex_app__set_thread_archived');
  assert.equal(archiveAction.observationAction.tool, 'mcp__codex_app__list_archived_threads');
  const ambiguous = f.relay.recordNativeResult(prepared.assignment, 'director', archiveAction.nativeAction.id,
    result({ threadId: 'coordinator' }));
  assert.equal(ambiguous.status, 'ARCHIVE_PENDING');
  assert.equal(f.relay.report('retire', prepared.assignment, 'director').nativeAction, undefined);
  const archived = f.relay.recordNativeResult(prepared.assignment, 'director', archiveAction.nativeAction.id,
    result({ threads: [{ threadId: 'coordinator', title: 'task' }] }));
  assert.equal(archived.status, 'RETIRED');
});
