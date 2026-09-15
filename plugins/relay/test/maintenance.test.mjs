import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, cli, cliProcess, jsonFile } from './helpers.mjs';

function revokedChild() {
  const f = fixture();
  const parent = f.start();
  const child = f.relay.handoff(parent.ready.ticket, 'coordinator', f.spec);
  const recovery = f.relay.recover(child.ticket, 'coordinator', { kind: 'revoke-never-enabled' });
  f.relay.recover(recovery.ticket, 'director', { kind: 'preserve-and-approve', revision: f.git('rev-parse', 'HEAD'), writersStopped: true, reason: 'Preserve result' });
  return { ...f, parent, child, resolution: { actionId: child.nativeAction.id, neverInvoked: true, reason: 'Creation was never called' } };
}

test('never-created child settles without archive and preserves a new writer', () => {
  const f = revokedChild();
  assert.throws(() => f.relay.report('retire', f.child.assignment, 'coordinator'), /No native task identity/);
  assert.equal(f.relay.report('retire', f.parent.prepared.assignment, 'director').status, 'RECIPIENT_OBLIGATION_PENDING');
  // Older versions could persist a null-target idle action. Retain it unchanged.
  f.relay.store.locked(control => {
    const record = f.relay.record(control, f.child.assignment);
    record.idleCheck = { id: 'historical-null-target' };
    f.relay.store.commit(control, [record]);
  });
  const fresh = f.start('new-coordinator');
  const before = f.relay.store.control().permission;
  const args = { assignment: f.child.assignment, actor: 'coordinator', resolution: jsonFile(f.resolution) };
  assert.equal(cli(f.repo, 'dispose-uncreated', args).status, 'DISPOSED_UNCREATED');
  assert.equal(cli(f.repo, 'dispose-uncreated', args).status, 'DISPOSED_UNCREATED');
  assert.deepEqual(f.relay.store.control().permission, before);
  assert.equal(f.relay.status(fresh.prepared.assignment).status, 'READY');
  assert.equal(f.relay.report('retire', f.child.assignment, 'coordinator').status, 'DISPOSED_UNCREATED');
  const record = f.relay.record(f.relay.store.control(), f.child.assignment);
  assert.equal(record.archive, undefined);
  assert.equal(record.idleCheck.id, 'historical-null-target');
  assert.throws(() => f.relay.recordNativeResult(f.child.assignment, 'coordinator', record.idleCheck.id, {}), /Exact sender/);
  assert.equal(f.relay.report('retire', f.parent.prepared.assignment, 'director').status, 'SENDER_IDLE_REQUIRED');
  assert.throws(() => f.relay.recordNative(f.child.assignment, 'coordinator', { actionId: f.child.nativeAction.id, status: 'ready', taskId: 'late-task' }), /Disposed creation/);
  assert.throws(() => f.relay.disposeUncreated(f.child.assignment, 'coordinator', { ...f.resolution, reason: 'changed' }), /conflicts/);
});

test('top-level revoked creation disposal needs no native task or archive', () => {
  const f = fixture();
  const prepared = f.relay.prepare(f.spec, 'director');
  f.relay.recover(prepared.ticket, 'director', { kind: 'revoke-never-enabled' });
  assert.equal(f.relay.disposeUncreated(prepared.assignment, 'director', {
    actionId: prepared.nativeAction.id, neverInvoked: true, reason: 'No native call',
  }).status, 'DISPOSED_UNCREATED');
  const result = f.relay.status(prepared.assignment);
  assert.equal(result.nativeAction, undefined);
  assert.equal(result.archive, null);
  assert.equal(f.relay.store.control().permission, null);
});

test('disposal requires exact creator, action, revocation and absence of observed creation', () => {
  const f = revokedChild();
  assert.throws(() => f.relay.disposeUncreated(f.child.assignment, 'director', f.resolution), /creating actor/);
  assert.throws(() => f.relay.disposeUncreated(f.child.assignment, 'coordinator', { ...f.resolution, actionId: 'wrong' }), /Exact creation/);
  assert.throws(() => f.relay.disposeUncreated(f.child.assignment, 'coordinator', { ...f.resolution, neverInvoked: false }), /Exact creation/);
  for (const change of [{ enabled: true }, { task: 'actual-task' }, { archive: { status: 'ambiguous' } },
    { creation: { status: 'ambiguous' } }, { creation: { provisional: 'client-id' } }, { outcome: null }]) {
    const g = revokedChild();
    g.relay.store.locked(control => {
      const record = g.relay.record(control, g.child.assignment);
      if (change.creation) Object.assign(record.creation, change.creation);
      else Object.assign(record, change);
      g.relay.store.commit(control, [record]);
    });
    assert.throws(() => g.relay.disposeUncreated(g.child.assignment, 'coordinator', g.resolution), /requires revoked/);
  }
  const g = fixture();
  const pending = g.relay.prepare(g.spec, 'director');
  assert.throws(() => g.relay.disposeUncreated(pending.assignment, 'director', { ...f.resolution, actionId: pending.nativeAction.id }), /requires revoked/);
});

test('idle forward adoption preserves cleanup, supports next finish and exact replay', () => {
  const f = revokedChild();
  const previousRevision = f.git('rev-parse', 'HEAD');
  const revision = f.commit('docs/plan.md', 'approved plan');
  const resolution = { previousRevision, revision, branch: 'main', writersStopped: true, reason: 'Approved plan commit' };
  assert.throws(() => f.relay.prepare(f.spec, 'director'), /adopt-baseline/);
  const records = f.relay.store.control().assignments;
  const args = { actor: 'director', resolution: jsonFile(resolution) };
  assert.equal(cli(f.repo, 'adopt-baseline', args).status, 'BASELINE_ADOPTED');
  assert.equal(cli(f.repo, 'adopt-baseline', args).status, 'ALREADY_ADOPTED');
  assert.deepEqual(f.relay.store.control().assignments, records);
  assert.equal(f.relay.report('retire', f.parent.prepared.assignment, 'director').status, 'RECIPIENT_OBLIGATION_PENDING');
  const next = f.start('next');
  assert.throws(() => f.relay.adoptBaseline('director', resolution), /idle source/);
  f.commit('src/value.txt', 'next result');
  assert.equal(f.relay.finish(next.ready.ticket, 'next').status, 'SOURCE_RELEASED');
});

test('baseline adoption rejects dirty, stale, other branch and backward source', () => {
  const f = fixture();
  const started = f.start();
  f.relay.finish(started.ready.ticket, 'coordinator');
  const previousRevision = f.git('rev-parse', 'HEAD');
  const revision = f.commit('docs/plan.md', 'plan');
  const resolution = { previousRevision, revision, branch: 'main', writersStopped: true, reason: 'Plan' };
  const adopt = overrides => f.relay.adoptBaseline('director', { ...resolution, ...overrides });
  assert.throws(() => adopt({ writersStopped: false }), /Explicit previous/);
  assert.throws(() => adopt({ previousRevision: 'a'.repeat(40) }), /Previous approved/);
  assert.throws(() => adopt({ revision: previousRevision }), /Checkpoint drift/);
  writeFileSync(join(f.repo, 'untracked.txt'), 'dirty');
  assert.throws(() => adopt({}), /dirty/);
  f.git('add', 'untracked.txt'); f.git('commit', '-m', 'preserve');
  const current = f.git('rev-parse', 'HEAD');
  f.git('switch', '-c', 'other');
  assert.throws(() => adopt({ branch: 'other', revision: current }), /retain the approved/);
  f.git('switch', 'main');
  adopt({ revision: current });
  // Keep the newer commit on another branch while checking backward rejection.
  f.git('branch', 'preserved-newer', current);
  f.git('reset', '--hard', previousRevision);
  assert.throws(() => adopt({ previousRevision: current, revision: previousRevision }));
});

test('ignored local scratch stays outside verification, ordinary files do not', () => {
  const f = fixture();
  writeFileSync(join(f.repo, '.git/info/exclude'), '/.local/relay/\n');
  const directory = join(f.repo, '.local/relay/preparation');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'request.json'), '{}');
  assert.equal(f.git('check-ignore', '.local/relay/preparation/request.json'), '.local/relay/preparation/request.json');
  f.spec.checks = [[process.execPath, '-e', "require('node:fs').writeFileSync('.local/relay/preparation/result.json', '{}')"]];
  const first = f.start();
  assert.equal(f.relay.finish(first.ready.ticket, 'coordinator').status, 'SOURCE_RELEASED');
  f.spec.checks = [[process.execPath, '-e', "require('node:fs').writeFileSync('ordinary.json', '{}')"]];
  const second = f.start('second');
  assert.throws(() => f.relay.finish(second.ready.ticket, 'second'), /Verification changed/);
  assert.notEqual(cliProcess(f.repo, 'dispose-uncreated', { assignment: second.prepared.assignment, actor: 'director', resolution: jsonFile({}) }).status, 0);
});
