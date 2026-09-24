import { createHash } from 'node:crypto';
import { Routes } from './routes.mjs';
import { submitQueueNotification } from './queue-notification.mjs';

// Routing only: no result checks, message storage, or lifecycle writes.
export function captureStopEvent(event) {
  if (event?.hook_event_name !== 'Stop'
    || !['session_id', 'turn_id', 'cwd', 'last_assistant_message'].every(key =>
      typeof event[key] === 'string' && event[key].length > 0)) {
    return { status: 'ignored', reason: 'unsupported-stop-event' };
  }
  let routes;
  try { routes = new Routes(event.cwd); }
  catch { return { status: 'ignored', reason: 'relay-repository-unavailable' }; }
  const registry = routes.read();
  const route = Object.hasOwn(registry.routes, event.session_id) ? registry.routes[event.session_id] : undefined;
  if (!route) return { status: 'ignored', reason: 'relay-sender-unbound' };
  // Another hook can continue a turn. Replay the same body with the same ID,
  // but let a corrected final through even when the native turn ID is unchanged.
  const hex = createHash('sha256').update(JSON.stringify([
    route.id, event.session_id, event.turn_id, event.last_assistant_message,
  ])).digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return { status: 'ready', notification: {
    id, sender: event.session_id, recipient: route.manager, hostId: 'local',
    senderHostId: 'local', text: event.last_assistant_message,
  } };
}

export async function processStopEvent(event, { submit = submitQueueNotification } = {}) {
  const captured = captureStopEvent(event);
  if (!captured.notification) return captured;
  let notificationOutcome;
  try { notificationOutcome = await submit(captured.notification); }
  catch { notificationOutcome = { status: 'ambiguous', reason: 'transport-error' }; }
  return { status: notificationOutcome.status, notificationOutcome };
}
