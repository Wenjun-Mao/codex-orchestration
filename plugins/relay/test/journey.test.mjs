import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fixture, deliver, cli, startCli, jsonFile } from './helpers.mjs';

test('connected CLI: preparation → local work → executor → verification → real fixture bytes → receipt/archive → useful successor', () => {
  const { repo, spec, commit, git } = fixture();
  const p = cli(repo, 'prepare', { actor: 'director', spec: jsonFile(spec) });
  assert.equal(p.permittedSourceActivity, 'none');
  const early = startCli(repo, p.ticket, 'coordinator');
  assert.equal(early.status, 'BINDING_PENDING');
  cli(repo, 'record-native', { assignment: p.assignment, actor: 'director', observation: jsonFile({ actionId: p.nativeAction.id, status: 'ready', taskId: 'coordinator' }) });
  const ready = startCli(repo, p.ticket, 'coordinator');
  assert.equal(ready.status, 'READY');
  commit('src/value.txt', 'coordinator local work');
  const child = cli(repo, 'handoff', { ticket: ready.ticket, actor: 'coordinator', spec: jsonFile(spec) });
  cli(repo, 'record-native', { assignment: child.assignment, actor: 'coordinator', observation: jsonFile({ actionId: child.nativeAction.id, status: 'ready', taskId: 'executor' }) });
  const executor = startCli(repo, child.ticket, 'executor');
  const revision = commit('src/child.txt', 'executor product work');
  const released = cli(repo, 'finish', { ticket: executor.ticket, actor: 'executor' });
  assert.equal(released.status, 'TRANSFERRED_TO_VERIFICATION');
  const reserved = cli(repo, 'status', { assignment: p.assignment });
  assert.equal(reserved.status, 'VERIFY');
  assert.equal(reserved.checkpoint, revision);
  cli(repo, 'verify', { ticket: reserved.ticket, actor: 'coordinator', decision: 'finish' });
  for (const [id, sender, recipient] of [[child.assignment, 'executor', 'coordinator'], [p.assignment, 'coordinator', 'director']]) {
    const status = cli(repo, 'status', { assignment: id });
    const event = { sender, correlation: status.report.correlation, eventId: 'fixture-' + id, text: 'Fixture final bytes\nwith exact newline\n' };
    cli(repo, 'capture', { assignment: id, actor: sender, event: jsonFile(event) });
    assert.equal(cli(repo, 'status', { assignment: id }).report.receipt, null);
    const read = cli(repo, 'read-report', { assignment: id, actor: recipient });
    assert.equal(cli(repo, 'status', { assignment: id }).report.receipt, null);
    cli(repo, 'acknowledge', {
      assignment: id, actor: recipient,
      'event-id': read.acknowledgement.eventId,
      digest: read.acknowledgement.digest,
      'association-digest': read.acknowledgement.associationDigest,
    });
    cli(repo, 'accept', { assignment: id, actor: recipient });
    const archive = cli(repo, 'retire', { assignment: id, actor: recipient });
    assert.deepEqual(archive.nativeAction.args, { threadId: sender, archived: true });
    cli(repo, 'record-native', { assignment: id, actor: recipient, observation: jsonFile({ kind: 'archive', actionId: archive.nativeAction.id, taskId: sender, status: 'archived' }) });
  }
  const successor = cli(repo, 'prepare', { actor: 'director', spec: jsonFile({ ...spec, dependencies: [p.assignment] }) });
  cli(repo, 'record-native', { assignment: successor.assignment, actor: 'director', observation: jsonFile({ actionId: successor.nativeAction.id, status: 'ready', taskId: 'successor' }) });
  const sr = startCli(repo, successor.ticket, 'successor');
  const newer = commit('src/value.txt', 'useful successor update');
  cli(repo, 'finish', { ticket: sr.ticket, actor: 'successor' });
  assert.notEqual(newer, revision);
  assert.equal(cli(repo, 'status', { assignment: p.assignment }).report.association.result.revision, revision);
  assert.equal(git('branch', '--show-current'), 'main');
  assert.equal(existsSync(repo), true);
});

test('accumulated solo history: accepted, revoked provisional, failed rejected commit, independent successor, delayed old report', () => {
  const f = fixture();
  const first = f.start();
  f.commit('src/value.txt', 'first'); f.relay.finish(first.ready.ticket, 'coordinator');
  const completed = deliver(f.relay, first.prepared.assignment, 'coordinator', 'director');
  const abandoned = f.relay.prepare(f.spec, 'director');
  f.relay.recordNative(abandoned.assignment, 'director', { actionId: abandoned.nativeAction.id, status: 'provisional', clientThreadId: 'pending-native' });
  f.relay.recover(abandoned.ticket, 'director', { kind: 'revoke-never-enabled' });
  f.relay.recordNative(abandoned.assignment, 'director', { actionId: abandoned.nativeAction.id, status: 'ready', taskId: 'late-task', clientThreadId: 'pending-native' });
  assert.throws(() => f.relay.start(abandoned.ticket, 'late-task'), /revoked/);
  const failed = f.start('failed');
  const rejected = f.commit('outside.txt', 'retained violation');
  assert.throws(() => f.relay.finish(failed.ready.ticket, 'failed'), /Scope violation/);
  assert.throws(() => f.relay.prepare(f.spec, 'director'), /reserved/);
  f.relay.recover(failed.ready.ticket, 'director', { kind: 'preserve-and-approve', writersStopped: true, revision: rejected, reason: 'Director reviewed and approves preserved source as independent baseline, without accepting failed work' });
  assert.throws(() => f.relay.prepare({ ...f.spec, dependencies: [failed.prepared.assignment] }, 'director'), /not accepted/);
  const next = f.start('next');
  f.commit('src/value.txt', 'later useful work'); f.relay.finish(next.ready.ticket, 'next');
  deliver(f.relay, failed.prepared.assignment, 'failed', 'director', 'rejected');
  assert.equal(f.relay.status(first.prepared.assignment).report.final.digest, completed.captured.envelope.digest);
  assert.equal(f.relay.status(abandoned.assignment).outcome, 'revoked');
  assert.equal(f.git('show', 'HEAD:outside.txt'), 'retained violation');
});
