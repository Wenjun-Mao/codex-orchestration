import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Relay } from '../lib/relay.mjs';
import { inScope, validateScope, validateChecks } from '../lib/source.mjs';
import { Store } from '../lib/store.mjs';
import { fixture } from './helpers.mjs';

test('literal scope and checks reject ambiguous contracts', () => {
  assert.equal(inScope('src/a', ['src/']), true);
  assert.equal(inScope('src-other/a', ['src/']), false);
  assert.equal(inScope('readme-more', ['readme']), false);
  for (const paths of [[], ['../x'], ['/x'], ['src/*'], ['a\\b']]) assert.throws(() => validateScope(paths));
  for (const checks of [[], ['PASS'], [[]]]) assert.throws(() => validateChecks(checks));
});

test('ownership exclusion, provisional correlation, and stale resume after continuation', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  assert.throws(() => f.relay.prepare(f.spec, 'director'), /reserved/);
  assert.throws(() => f.relay.start(prepared.ticket, 'foreign'), /actor/);
  const child = f.relay.handoff(ready.ticket, 'coordinator', f.spec);
  assert.throws(() => f.relay.finish(ready.ticket, 'coordinator'), /permission/);
  f.relay.recordNative(child.assignment, 'coordinator', { actionId: child.nativeAction.id, status: 'provisional', clientThreadId: 'client-one' });
  assert.equal(f.relay.start(child.ticket, 'executor').status, 'BINDING_PENDING');
  assert.throws(() => f.relay.recordNative(child.assignment, 'coordinator', { actionId: child.nativeAction.id, status: 'ready', taskId: 'executor' }), /correlate/);
  f.relay.recordNative(child.assignment, 'coordinator', { actionId: child.nativeAction.id, status: 'ready', taskId: 'executor', clientThreadId: 'client-one' });
  const er = f.relay.start(child.ticket, 'executor');
  f.commit('src/value.txt', 'child result'); f.relay.finish(er.ticket, 'executor');
  assert.throws(() => f.relay.start(er.ticket, 'executor'), /transferred/);
  assert.throws(() => f.relay.prepare(f.spec, 'director'), /reserved/);
  const reservation = f.relay.status(prepared.assignment);
  const continued = f.relay.verify(reservation.ticket, 'coordinator', 'continue');
  assert.equal(continued.status, 'READY');
  assert.throws(() => f.relay.start(prepared.ticket, 'coordinator'), /Stale/);
  assert.throws(() => f.relay.finish(ready.ticket, 'coordinator'), /permission/);
  f.commit('src/value.txt', 'coordinator continuation');
  f.relay.finish(continued.ticket, 'coordinator');
});

test('start reporting facts survive crash before and after the only ownership commit', () => {
  for (const point of ['facts-persisted', 'control-committed']) {
    const f = fixture(); const p = f.relay.prepare(f.spec, 'director'); f.bind(p, 'coordinator');
    const crashing = new Relay(f.repo, { fault: at => { if (at === point) throw new Error('injected process boundary'); } });
    assert.throws(() => crashing.start(p.ticket, 'coordinator'), /injected/);
    const control = f.relay.store.control();
    assert.equal(control.permission.mode, point === 'facts-persisted' ? 'reserved' : 'write');
    const record = f.relay.store.assignment(control, p.assignment);
    assert.equal(record.report.sender, 'coordinator');
    assert.equal(record.enabled, point === 'control-committed');
    if (record.enabled) assert.throws(() => f.relay.recover(`${p.assignment}:${control.permission.generation}`, 'director', { kind: 'revoke-never-enabled' }), /Possible writer/);
    assert.equal(f.relay.start(p.ticket, 'coordinator').status, 'READY');
  }
});

test('executor release crash has old writer or exact verifier, never an available gap', () => {
  for (const point of ['facts-persisted', 'control-committed']) {
    const f = fixture(); const { prepared, ready } = f.start();
    const child = f.relay.handoff(ready.ticket, 'coordinator', f.spec); f.bind(child, 'executor', 'coordinator');
    const er = f.relay.start(child.ticket, 'executor'); const result = f.commit('src/value.txt', 'done');
    const crashing = new Relay(f.repo, { fault: at => { if (at === point) throw new Error('injected crash'); } });
    assert.throws(() => crashing.finish(er.ticket, 'executor'), /injected/);
    const p = f.relay.store.control().permission;
    assert.equal(p.assignment, point === 'facts-persisted' ? child.assignment : prepared.assignment);
    assert.equal(p.mode, point === 'facts-persisted' ? 'write' : 'verify');
    if (p.mode === 'verify') {
      assert.equal(p.checkpoint, result);
      assert.equal(f.relay.status(child.assignment).report.association.result.revision, result);
    }
    f.relay.finish(er.ticket, 'executor');
    assert.equal(f.relay.store.control().permission.mode, 'verify');
  }
});

test('locks never auto-reclaim and recovery requires exact identity plus externally stopped commands', () => {
  const f = fixture(); f.relay.prepare(f.spec, 'director');
  const path = join(f.relay.store.root, 'transition.lock');
  writeFileSync(path, JSON.stringify({ token: 'abandoned-token', pid: 99999999 }));
  assert.throws(() => f.relay.prepare(f.spec, 'director'), /lock exists/);
  assert.throws(() => f.relay.prepare(f.spec, 'director'), /lock exists/);
  assert.equal(JSON.parse(readFileSync(path)).token, 'abandoned-token');
  assert.throws(() => f.relay.store.recoverLock({ token: 'abandoned-token' }), /stopped/);
  assert.throws(() => f.relay.store.recoverLock({ token: 'wrong', commandsStopped: true }), /identity/);
  f.relay.store.recoverLock({ token: 'abandoned-token', commandsStopped: true });
  assert.equal(existsSync(path), false);
  const another = new Store(f.relay.store.root);
  f.relay.store.locked(() => assert.throws(() => another.locked(() => assert.fail('second owner entered')), /lock exists/));
});

test('intermediate disallowed commit remains disallowed after a revert', () => {
  const f = fixture(); const { ready } = f.start();
  const forbidden = f.commit('outside.txt', 'violation'); f.git('revert', '--no-edit', forbidden);
  assert.throws(() => f.relay.finish(ready.ticket, 'coordinator'), /Scope violation/);
  assert.equal(f.relay.store.control().permission.mode, 'write');
});

test('checks cannot certify changed clean HEAD, index, refs, or untracked source', () => {
  const mutators = [
    "require('node:child_process').execFileSync('git',['commit','--allow-empty','-m','mutating check'])",
    "require('node:child_process').execFileSync('git',['update-ref','refs/heads/other','HEAD'])",
    "require('node:fs').writeFileSync('new.txt','untracked drift')",
    "require('node:fs').writeFileSync('src/value.txt','changed');require('node:child_process').execFileSync('git',['add','src/value.txt'])",
  ];
  for (const code of mutators) {
    const f = fixture(); const p = f.relay.prepare({ ...f.spec, checks: [[process.execPath, '-e', code]] }, 'director'); f.bind(p, 'coordinator');
    const r = f.relay.start(p.ticket, 'coordinator');
    assert.throws(() => f.relay.finish(r.ticket, 'coordinator'), /Verification changed/);
    assert.equal(f.relay.status(p.assignment).report.association, null);
    assert.equal(f.relay.store.control().permission.mode, 'write');
  }
});

test('failed checks and drift in reserved verification do not release source', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  const child = f.relay.handoff(ready.ticket, 'coordinator', { ...f.spec, checks: [[process.execPath, '-e', 'process.exit(2)']] });
  f.bind(child, 'executor', 'coordinator'); const er = f.relay.start(child.ticket, 'executor');
  f.commit('src/value.txt', 'child'); f.relay.finish(er.ticket, 'executor');
  const reserved = f.relay.status(prepared.assignment);
  assert.throws(() => f.relay.verify(reserved.ticket, 'coordinator', 'finish'), /Check failed/);
  f.commit('src/value.txt', 'unauthorized drift');
  assert.throws(() => f.relay.verify(reserved.ticket, 'coordinator', 'finish'), /Checkpoint drift/);
  assert.equal(f.relay.store.control().permission.mode, 'verify');
});

test('dirty recovery preserves source and source approval is distinct from result acceptance', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  writeFileSync(join(f.repo, 'unsaved.txt'), 'preserve me');
  const resolution = { kind: 'preserve-and-approve', writersStopped: true, revision: f.git('rev-parse', 'HEAD'), reason: 'reviewed' };
  assert.throws(() => f.relay.recover(ready.ticket, 'director', resolution), /dirty/);
  assert.equal(readFileSync(join(f.repo, 'unsaved.txt'), 'utf8'), 'preserve me');
  f.git('add', 'unsaved.txt'); f.git('commit', '-m', 'preserved failed source');
  assert.throws(() => f.relay.recover(ready.ticket, 'director', resolution), /actual revision/);
  resolution.revision = f.git('rev-parse', 'HEAD');
  f.relay.recover(ready.ticket, 'director', resolution);
  assert.equal(f.relay.status(prepared.assignment).decision, 'rejected');
  assert.equal(f.relay.store.control().permission, null);
});

test('Flow namespace refuses source admission without changing Flow files', () => {
  const f = fixture(); mkdirSync(join(f.relay.repo.common, 'codex-flow'));
  assert.throws(() => f.relay.prepare(f.spec, 'director'), /Flow state/);
  assert.equal(existsSync(join(f.relay.repo.common, 'relay')), false);
  assert.equal(f.relay.store.control().permission, null);
});

test('continuation preserves accepted executor checkpoint ancestry on every new write generation', () => {
  const f = fixture(); const baseline = f.git('rev-parse', 'HEAD'); const { prepared, ready } = f.start();
  const child = f.relay.handoff(ready.ticket, 'coordinator', f.spec); f.bind(child, 'executor', 'coordinator');
  const er = f.relay.start(child.ticket, 'executor'); f.commit('src/value.txt', 'accepted child'); f.relay.finish(er.ticket, 'executor');
  const continued = f.relay.verify(f.relay.status(prepared.assignment).ticket, 'coordinator', 'continue');
  // Disposable regression fixture only: model an unauthorized history rewrite.
  f.git('reset', '--hard', baseline); f.commit('src/value.txt', 'history without child');
  assert.throws(() => f.relay.finish(continued.ticket, 'coordinator'));
  assert.throws(() => f.relay.handoff(continued.ticket, 'coordinator', f.spec));
  assert.throws(() => f.relay.start(continued.ticket, 'coordinator'));
  assert.equal(f.relay.status(child.assignment).decision, 'accepted');
  assert.equal(f.relay.store.control().permission.mode, 'write');
});

test('lost preparation/handoff output remains discoverable without repeating native creation', () => {
  const f = fixture();
  const crashing = new Relay(f.repo, { fault: point => { if (point === 'control-committed') throw new Error('lost output'); } });
  assert.throws(() => crashing.prepare(f.spec, 'director'), /lost output/);
  const pending = f.relay.status();
  assert.equal(pending.status, 'BINDING_PENDING');
  assert.ok(pending.ticket && pending.creation.id);
  assert.equal(pending.nativeAction, undefined);
  f.relay.recordNative(pending.assignment, 'director', { actionId: pending.creation.id, status: 'ready', taskId: 'coordinator' });
  const ready = f.relay.start(pending.ticket, 'coordinator');
  assert.throws(() => crashing.handoff(ready.ticket, 'coordinator', f.spec), /lost output/);
  const child = f.relay.status(pending.assignment);
  assert.equal(child.status, 'BINDING_PENDING');
  assert.notEqual(child.assignment, pending.assignment);
  assert.ok(child.creation.id && child.ticket);
  assert.equal(child.nativeAction, undefined);
  const recovered = f.relay.recover(child.ticket, 'coordinator', { kind: 'revoke-never-enabled' });
  assert.equal(recovered.actor, 'director');
  assert.equal(recovered.status, 'RECOVERY');
  f.relay.recover(recovered.ticket, 'director', { kind: 'preserve-and-approve', revision: f.git('rev-parse', 'HEAD'), writersStopped: true, reason: 'Stopped coordinator and explicitly reviewed retained source' });
});

test('real process exit leaves a lock and reconciles the committed start after explicit command recovery', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = fixture(); const p = f.relay.prepare(f.spec, 'director'); f.bind(p, 'coordinator');
  const moduleUrl = new URL('../lib/relay.mjs', import.meta.url).href;
  const code = `import { Relay } from ${JSON.stringify(moduleUrl)}; const relay = new Relay(process.argv[1], { fault: at => { if (at === 'control-committed') process.exit(73); } }); relay.start(process.argv[2], 'coordinator');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.repo, p.ticket]);
  assert.equal(child.status, 73);
  assert.equal(f.relay.store.control().permission.mode, 'write');
  assert.throws(() => f.relay.start(p.ticket, 'coordinator'), /lock exists/);
  const lock = JSON.parse(readFileSync(join(f.relay.store.root, 'transition.lock'), 'utf8'));
  f.relay.store.recoverLock({ token: lock.token, commandsStopped: true });
  assert.equal(f.relay.start(p.ticket, 'coordinator').status, 'READY');
});
