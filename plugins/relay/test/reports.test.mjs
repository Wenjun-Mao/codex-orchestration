import test from 'node:test';
import assert from 'node:assert/strict';
import { Relay } from '../lib/relay.mjs';
import { fixture, deliver } from './helpers.mjs';

test('frozen final conflicts, foreign association and exact receipt remain independent from queued/accepted', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  assert.throws(() => f.relay.report('capture', prepared.assignment, 'coordinator', {}), /Frozen/);
  const old = f.commit('src/value.txt', 'old'); f.relay.finish(ready.ticket, 'coordinator');
  assert.throws(() => f.relay.report('retire', prepared.assignment, 'director'), /capture/);
  const next = f.start('successor'); f.commit('src/value.txt', 'new'); f.relay.finish(next.ready.ticket, 'successor');
  const report = f.relay.status(prepared.assignment).report;
  const event = { sender: 'coordinator', correlation: report.correlation, eventId: 'final-one', text: 'exact\nbytes' };
  assert.throws(() => f.relay.report('capture', prepared.assignment, 'successor', event), /sender/);
  assert.throws(() => f.relay.report('capture', prepared.assignment, 'coordinator', { ...event, correlation: f.relay.status(next.prepared.assignment).report.correlation }), /association/);
  const captured = f.relay.report('capture', prepared.assignment, 'coordinator', event);
  assert.deepEqual(f.relay.report('capture', prepared.assignment, 'coordinator', event), captured);
  assert.throws(() => f.relay.report('capture', prepared.assignment, 'coordinator', { ...event, text: 'different' }), /conflict/);
  assert.throws(() => f.relay.report('capture', prepared.assignment, 'coordinator', { ...event, eventId: 'different-event' }), /conflict/);
  const submit = f.relay.report('submit', prepared.assignment, 'coordinator');
  assert.equal(submit.request.envelope.result.revision, old);
  assert.equal(f.relay.report('submit', prepared.assignment, 'coordinator').request, undefined);
  f.relay.report('observe-report', prepared.assignment, 'coordinator', { submissionId: submit.request.id, status: 'queued' });
  assert.equal(f.relay.status(prepared.assignment).report.receipt, null);
  assert.equal(f.relay.status(prepared.assignment).decision, null);
  assert.throws(() => f.relay.report('accept', prepared.assignment, 'director'), /receipt/);
  assert.throws(() => f.relay.report('receive', prepared.assignment, 'director', { envelope: { ...captured.envelope, text: 'changed' } }), /exact/);
  const reordered = Object.fromEntries(Object.entries(captured.envelope).reverse());
  f.relay.report('receive', prepared.assignment, 'director', { envelope: reordered });
  assert.equal(f.relay.status(prepared.assignment).decision, null);
  f.relay.report('accept', prepared.assignment, 'director');
  const archival = f.relay.report('retire', prepared.assignment, 'director');
  assert.equal(f.relay.report('retire', prepared.assignment, 'director').nativeAction, undefined);
  assert.throws(() => f.relay.recordNative(prepared.assignment, 'director', { kind: 'archive', actionId: archival.nativeAction.id, taskId: 'successor', status: 'archived' }), /identity/);
  f.relay.recordNative(prepared.assignment, 'director', { kind: 'archive', actionId: archival.nativeAction.id, taskId: 'coordinator', status: 'ambiguous' });
  assert.notEqual(f.relay.status(prepared.assignment).status, 'RETIRED');
  assert.equal(f.relay.store.control().permission, null);
});

test('submission crash after attempt persistence does not return a resend request', () => {
  const f = fixture(); const { prepared, ready } = f.start(); f.relay.finish(ready.ticket, 'coordinator');
  f.relay.report('capture', prepared.assignment, 'coordinator', { sender: 'coordinator', correlation: f.relay.status(prepared.assignment).report.correlation, eventId: 'event', text: 'captured' });
  const crashing = new Relay(f.repo, { fault: point => { if (point === 'control-committed') throw new Error('lost output'); } });
  assert.throws(() => crashing.report('submit', prepared.assignment, 'coordinator'), /lost output/);
  const pending = f.relay.report('submit', prepared.assignment, 'coordinator');
  assert.equal(pending.request, undefined);
  assert.equal(pending.status, 'ambiguous');
});

test('revoked task identity observed late may report and retire without regaining permission', () => {
  const f = fixture(); const p = f.relay.prepare(f.spec, 'director');
  f.relay.recover(p.ticket, 'director', { kind: 'revoke-never-enabled' });
  f.bind(p, 'late');
  assert.throws(() => f.relay.start(p.ticket, 'late'), /revoked/);
  deliver(f.relay, p.assignment, 'late', 'director', 'rejected');
  assert.equal(f.relay.status(p.assignment).status, 'RETIRED');
  assert.equal(f.relay.store.control().permission, null);
});

test('recipient rejection cannot be overwritten by later verification; recovery reports disposition provenance', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  const child = f.relay.handoff(ready.ticket, 'coordinator', f.spec); f.bind(child, 'executor', 'coordinator');
  const er = f.relay.start(child.ticket, 'executor'); const revision = f.commit('src/value.txt', 'executor rejected work');
  f.relay.finish(er.ticket, 'executor');
  const captured = f.relay.report('capture', child.assignment, 'executor', { sender: 'executor', correlation: f.relay.status(child.assignment).report.correlation, eventId: 'rejected-event', text: 'executor final' });
  f.relay.report('submit', child.assignment, 'executor');
  f.relay.report('receive', child.assignment, 'coordinator', { envelope: captured.envelope, decision: 'rejected' });
  const verification = f.relay.status(prepared.assignment);
  assert.throws(() => f.relay.verify(verification.ticket, 'coordinator', 'finish'), /already rejected/);
  const recovery = f.relay.verify(verification.ticket, 'coordinator', 'reject');
  assert.equal(recovery.actor, 'director');
  f.relay.recover(recovery.ticket, 'director', { kind: 'preserve-and-approve', revision, writersStopped: true, reason: 'Explicitly approve preserved failed source' });
  const result = f.relay.status(prepared.assignment).report.association.result;
  assert.equal(result.kind, 'source-disposition');
  assert.equal(result.producer, undefined);
  assert.deepEqual(result.contributors, ['executor']);
  assert.equal(f.relay.status(child.assignment).decision, 'rejected');
});
