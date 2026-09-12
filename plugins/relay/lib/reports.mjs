import { randomUUID } from 'node:crypto';
import { requireThat } from './store.mjs';
import { idleObservation } from './notification.mjs';

// Product review and task retirement are independent of message delivery.
export function reportOperation(relay, control, record, operation, actor, input = {}) {
  const report = record.report;
  const command = (op, args = {}) => relay.command(op, { assignment: record.id, actor, ...args });
  const response = (status, next, extra = {}) => relay.response(actor, 'none', next, { status, ...extra });
  const save = value => { relay.store.commit(control, [record]); return value; };
  if (operation === 'observe-idle') {
    requireThat(actor === report.recipient && record.idleCheck?.id === input.actionId, 'Exact recipient idle action required');
    requireThat(input.taskId === record.task, 'Wrong sender observation');
    if (input.status !== 'idle') return save(idleObservation(relay, record));
    // Consume the observation by preparing archive now, never a reusable permit.
    return reportOperation(relay, control, record, 'retire', actor, { idleAction: input.actionId });
  }
  if (operation === 'accept' || operation === 'reject') {
    requireThat(actor === report.recipient, 'Exact recipient required before product decision');
    decide(record, operation === 'accept' ? 'accepted' : 'rejected');
    return save(response(record.decision.toUpperCase(), command('retire')));
  }
  if (operation === 'retire') {
    requireThat(actor === report.recipient, 'Task retirement belongs to exact recipient');
    requireThat(control.permission?.assignment !== record.id, 'Current source owner cannot retire');
    // A waiting coordinator still owns a return obligation even while its executor writes.
    requireThat(record.outcome && record.outcome !== 'awaiting-verification', 'Task source outcome is unresolved');
    requireThat(record.decision, 'Sender archival waits for product review');
    requireThat(record.outcome !== 'verified' || record.decision === 'accepted' || record.decision === 'rejected', 'Missing product decision');
    const childIds = [...new Set([...(record.children ?? []), ...(record.child ? [record.child] : [])])];
    const unresolved = childIds
      .map(id => relay.record(control, id))
      .filter(child => child.report.recipient === record.task && child.archive?.status !== 'archived');
    if (unresolved.length) {
      const pending = relay.reportingResponse(unresolved[0]);
      return relay.response(pending.actor, 'none', pending.nextAction, {
        status: 'RECIPIENT_OBLIGATION_PENDING',
        recipientToPreserve: record.task,
        blockedAssignments: unresolved.map(child => child.id),
      });
    }
    if (record.archive) return response(record.archive.status, command('record-native-result', { 'action-id': record.archive.id, result: '<exact-tool-result.json>' }));
    if ((!record.idleCheck || input.idleAction !== record.idleCheck.id)) {
      return save(idleObservation(relay, record));
    }
    record.archive = { id: randomUUID(), task: record.task, status: 'awaiting-observation' };
    const nativeArgs = { threadId: record.task, archived: true };
    if (record.taskHostId) nativeArgs.hostId = record.taskHostId;
    return save(response('ARCHIVE_PREPARED_ONCE', 'Archive this exact task once, then record affirmative observation; preserve its checkout.', {
      nativeAction: { id: record.archive.id, kind: 'archive', tool: 'mcp__codex_app__set_thread_archived', args: nativeArgs },
      recordCommand: command('record-native-result', { 'action-id': record.archive.id, result: '<exact-tool-result.json>' }),
      observationAction: { kind: 'archive-observation', tool: 'mcp__codex_app__list_archived_threads', args: record.taskHostId ? { hostId: record.taskHostId } : {} },
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
