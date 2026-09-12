import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deliver, cliProcess } from './helpers.mjs';

test('product review needs verified source and exact manager, not a stored message', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  assert.throws(() => f.relay.report('accept', prepared.assignment, 'director'), /Unverified/);
  f.relay.finish(ready.ticket, 'coordinator');
  assert.throws(() => f.relay.report('accept', prepared.assignment, 'foreign'), /recipient/);
  assert.equal(f.relay.status(prepared.assignment).status, 'DECISION_PENDING');
  deliver(f.relay, prepared.assignment, 'coordinator', 'director');
  assert.equal(f.relay.status(prepared.assignment).status, 'RETIRED');
  assert.equal(f.relay.status(prepared.assignment).report.final, undefined);
});
test('report capture, retrieval and receipt commands no longer exist', () => {
  const f = fixture(); const { prepared } = f.start();
  for (const operation of ['capture', 'read-report', 'acknowledge', 'submit', 'receive', 'prepare-receipt']) {
    const result = cliProcess(f.repo, operation, { assignment: prepared.assignment, actor: 'director' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown report operation/);
  }
});
test('child retirement remains ordered without receipt bookkeeping', () => {
  const f = fixture(); const { prepared, ready } = f.start();
  const child = f.relay.handoff(ready.ticket, 'coordinator', f.spec);
  f.bind(child, 'executor', 'coordinator');
  f.relay.finish(f.relay.start(child.ticket, 'executor').ticket, 'executor');
  f.relay.verify(f.relay.status(prepared.assignment).ticket, 'coordinator', 'finish');
  f.relay.report('accept', prepared.assignment, 'director');
  assert.equal(f.relay.report('retire', prepared.assignment, 'director').status, 'RECIPIENT_OBLIGATION_PENDING');
  deliver(f.relay, child.assignment, 'executor', 'coordinator');
  assert.throws(() => f.relay.report('reject', child.assignment, 'coordinator'), /already recorded/);
  assert.equal(f.relay.report('retire', prepared.assignment, 'director').status, 'SENDER_IDLE_REQUIRED');
});
