import { randomUUID } from 'node:crypto';
import { requireThat } from './store.mjs';
import { digest } from './source.mjs';

// Turn communication is not a source result. It never changes permission,
// acceptance, the sealed final, or retirement eligibility.
export function stopReportOperation(relay, control, record, operation, actor, input) {
  const report = record.report;
  requireThat(actor === report.sender && report.notificationMode === 'hook-queue-once', 'Exact hook sender required');
  requireThat(typeof input.eventId === 'string' && input.eventId.length > 0, 'Exact Stop turn required');
  const prior = report.stops?.find(item => item.eventId === input.eventId);
  if (operation === 'observe-stop-notification') {
    requireThat(prior?.notification.id === input.id && !prior.notification.observed, 'Exact unobserved Stop attempt required');
    requireThat(['queued', 'ambiguous'].includes(input.status) && typeof input.reason === 'string' && input.reason.length <= 200, 'Bounded notification outcome required');
    prior.notification = { ...prior.notification, status: input.status, reason: input.reason, observed: true };
    relay.store.commit(control, [record]);
    return { status: 'NOTIFICATION_OBSERVED' };
  }
  requireThat(operation === 'capture-stop' && typeof input.text === 'string', 'Stop text required');
  if (prior) {
    requireThat(prior.digest === digest(input.text) && prior.text === input.text, 'Stop bytes conflict');
    return { status: 'captured', assignment: record.id, eventId: prior.eventId, digest: prior.digest };
  }
  requireThat(!report.association && !record.archive, 'Unsealed active assignment required');
  const verification = record.lastVerification ?? { status: 'unavailable' };
  const item = { eventId: input.eventId, text: input.text, digest: digest(input.text),
    systemStatus: { resultSealed: false, verification, decision: record.decision,
      sourcePermission: control.permission?.mode ?? 'none' },
    notification: { id: randomUUID(), status: 'ambiguous', reason: 'attempt-persisted' } };
  report.stops = [...(report.stops ?? []), item];
  relay.store.commit(control, [record]);
  const detail = verification.status === 'failed'
    ? `Last verification failed (${verification.code}); changed fields: ${(verification.changedFields ?? []).join(', ') || 'not recorded'}.`
    : 'No sealed result; completion is not established.';
  return { status: 'captured', assignment: record.id, eventId: item.eventId, digest: item.digest,
    notification: { id: item.notification.id, recipient: report.recipient, hostId: record.recipientHostId,
      senderHostId: record.taskHostId,
      text: `Relay worker stopped — not completion or acceptance. ${detail} Source ownership is unchanged. Read the exact worker message and separate system status:\n${relay.command('read-report', { assignment: record.id, actor: report.recipient, 'event-id': item.eventId })}\nReview or reply; this notice does not authorize acceptance or cleanup.` } };
}

export function readStopReport(relay, record, actor, eventId) {
  requireThat(actor === record.report.recipient, 'Stop report is available only to its exact recipient');
  const item = record.report.stops?.find(value => value.eventId === eventId);
  requireThat(item && item.digest === digest(item.text), 'Exact captured Stop report required');
  return relay.response(actor, 'none', 'Review the message or reply to the worker; no result acceptance or cleanup is authorized by this Stop report.',
    { status: 'WORKER_STOPPED', report: { assignment: record.id, sender: record.task, recipient: actor, ...item } });
}
