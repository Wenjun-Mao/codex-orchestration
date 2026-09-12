import { randomUUID } from 'node:crypto';
import { requireThat } from './store.mjs';
import { digest, same } from './source.mjs';

// Observations enter only through explicit injected adapters/events in this source stage.
// No current HEAD lookup belongs here: reports remain bound after successors advance.
export function reportOperation(relay, control, record, operation, actor, input = {}) {
  const report = record.report;
  const command = (op, args = {}) => relay.command(op, { assignment: record.id, actor, ...args });
  const response = (status, next, extra = {}) => relay.response(actor, 'none', next, { status, ...extra });
  const save = value => { relay.store.commit(control, [record]); return value; };
  if (operation === 'capture') {
    requireThat(report.association && actor === report.sender, 'Frozen source result and exact sender required before final capture');
    requireThat(input.sender === report.sender && input.correlation === report.correlation && typeof input.eventId === 'string' && input.eventId.length && typeof input.text === 'string', 'Final event association mismatch');
    const final = { eventId: input.eventId, text: input.text, digest: digest(input.text) };
    if (report.final) requireThat(same(report.final, final), 'Final event or bytes conflict');
    else report.final = final;
    return save(response('CAPTURED', command('submit'), { envelope: { ...report.association, ...final } }));
  }
  if (operation === 'submit') {
    requireThat(actor === report.sender && report.final, 'Captured final and exact sender required');
    if (report.submission) return response(report.submission.status, command('observe-report', { observation: '<exact-submission-observation.json>' }));
    report.submission = { id: randomUUID(), status: 'ambiguous' };
    // Commit the attempt before returning any request that can cause an external send.
    return save(response('SUBMISSION_PREPARED_ONCE', 'Submit this exact request once through a qualified adapter, then observe its outcome.', {
      request: { id: report.submission.id, sender: report.sender, recipient: report.recipient, envelope: { ...report.association, ...report.final } },
      observeCommand: command('observe-report', { observation: '<exact-submission-observation.json>' }),
    }));
  }
  if (operation === 'observe-report') {
    requireThat(actor === report.sender && report.submission && input.submissionId === report.submission.id, 'Submission identity mismatch');
    requireThat(['queued', 'ambiguous'].includes(input.status), 'Observe queued or ambiguous; neither proves receipt');
    if (report.submission.status === 'queued') requireThat(input.status === 'queued', 'Queued evidence cannot regress');
    report.submission.status = input.status;
    return save(response(input.status.toUpperCase(), relay.command('receive', { assignment: record.id, actor: report.recipient, envelope: '<actually-received-envelope.json>' })));
  }
  if (operation === 'receive') {
    requireThat(actor === report.recipient && report.final && report.submission, 'Exact recipient and attempted captured report required');
    const expected = { ...report.association, ...report.final };
    requireThat(same(input.envelope, expected), 'Receipt must match exact sender, recipient, result, event and bytes');
    report.receipt = { recipient: actor, eventId: report.final.eventId, digest: report.final.digest };
    if (input.decision) decide(record, input.decision);
    return save(response(record.decision ? 'RECEIVED_WITH_DECISION' : 'RECEIVED', record.decision
      ? command('retire') : command('accept')));
  }
  if (operation === 'accept' || operation === 'reject') {
    requireThat(actor === report.recipient && report.receipt, 'Exact receipt required before recipient decision');
    decide(record, operation === 'accept' ? 'accepted' : 'rejected');
    return save(response(record.decision.toUpperCase(), command('retire')));
  }
  if (operation === 'retire') {
    requireThat(actor === report.recipient, 'Task retirement belongs to exact recipient');
    requireThat(control.permission?.assignment !== record.id, 'Current source owner cannot retire');
    // A waiting coordinator still owns a return obligation even while its executor writes.
    requireThat(record.outcome && record.outcome !== 'awaiting-verification', 'Task source outcome is unresolved');
    requireThat(report.final && report.receipt && record.decision, 'Sender archival waits for final capture, exact receipt and decision');
    requireThat(record.outcome !== 'verified' || record.decision === 'accepted' || record.decision === 'rejected', 'Missing product decision');
    const childIds = [...new Set([...(record.children ?? []), ...(record.child ? [record.child] : [])])];
    const unresolved = childIds
      .map(id => relay.record(control, id))
      .filter(child => child.report.recipient === record.task && !child.report.receipt);
    if (unresolved.length) {
      const pending = relay.reportingResponse(unresolved[0]);
      return relay.response(pending.actor, 'none', pending.nextAction, {
        status: 'RECIPIENT_OBLIGATION_PENDING',
        recipientToPreserve: record.task,
        blockedAssignments: unresolved.map(child => child.id),
      });
    }
    if (record.archive) return response(record.archive.status, command('record-native', { observation: '<exact-archive-observation.json>' }));
    record.archive = { id: randomUUID(), task: record.task, status: 'awaiting-observation' };
    return save(response('ARCHIVE_PREPARED_ONCE', 'Archive this exact task once, then record affirmative observation; preserve its checkout.', {
      nativeAction: { id: record.archive.id, kind: 'archive', args: { threadId: record.task, archived: true } },
      recordCommand: command('record-native', { observation: '<exact-archive-observation.json>' }),
    }));
  }
  if (operation === 'recordArchive') {
    requireThat(actor === report.recipient && record.archive && input.actionId === record.archive.id && input.taskId === record.archive.task, 'Archive identity mismatch');
    requireThat(['archived', 'ambiguous'].includes(input.status), 'Affirmative archive observation required; absence from a list is insufficient');
    if (record.archive.status === 'archived') requireThat(input.status === 'archived', 'Archival observation cannot regress');
    record.archive.status = input.status;
    return save(response(input.status === 'archived' ? 'RETIRED' : 'ARCHIVE_PENDING', command('status')));
  }
  throw new Error(`Unknown report operation: ${operation}`);
}
function decide(record, decision) {
  requireThat(['accepted', 'rejected'].includes(decision), 'Decision must be accepted or rejected');
  requireThat(!record.decision || record.decision === decision, 'Product decision is already recorded');
  requireThat(decision !== 'accepted' || record.outcome === 'verified', 'Unverified or failed work cannot be accepted');
  record.decision = decision;
}
