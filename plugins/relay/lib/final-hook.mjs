import { Relay } from './relay.mjs';

export function captureStopEvent(event, { notify = false } = {}) {
  if (
    event?.hook_event_name !== 'Stop'
    || (event.stop_hook_active === true && !notify)
    || typeof event.session_id !== 'string' || event.session_id.length === 0
    || typeof event.turn_id !== 'string' || event.turn_id.length === 0
    || typeof event.last_assistant_message !== 'string' || event.last_assistant_message.length === 0
    || typeof event.cwd !== 'string' || event.cwd.length === 0
  ) return { status: 'ignored', reason: 'unsupported-stop-event' };

  let relay;
  try { relay = new Relay(event.cwd); }
  catch { return { status: 'ignored', reason: 'relay-repository-unavailable' }; }
  const control = relay.store.control();
  const assignment = control.tasks?.[event.session_id];
  if (!assignment) return { status: 'ignored', reason: 'relay-sender-unbound' };
  const record = relay.record(control, assignment);
  if (!record.report.association) return { status: 'ignored', reason: 'source-result-unsealed' };
  if (event.stop_hook_active === true) {
    if (!record.report.advisory) return { status: 'ignored', reason: 'no-advisory-continuation' };
    relay.report('end-advisory', assignment, event.session_id, { eventId: event.turn_id });
    return { status: 'advisory-ended' };
  }
  const captured = relay.report('capture', assignment, event.session_id, {
    sender: event.session_id,
    correlation: record.report.correlation,
    eventId: event.turn_id,
    text: event.last_assistant_message,
    notify,
  });
  return {
    status: 'captured', assignment,
    eventId: event.turn_id, digest: captured.envelope.digest,
    ...(captured.hookOutput ? { hookOutput: captured.hookOutput } : {}),
  };
}
