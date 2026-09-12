import { randomUUID } from 'node:crypto';

// Persist the attempt in the capture transaction before continuing the sender.
// A lost response must not cause another externally visible send.
export function prepareAdvisory(relay, record) {
  const report = record.report;
  if (report.notificationMode !== 'advisory-once' || report.advisory) return null;
  const id = randomUUID();
  report.advisory = { id, status: 'ambiguous', endedEventId: null };
  const read = relay.command('read-report', { assignment: record.id, actor: report.recipient });
  const args = {
    threadId: report.recipient,
    prompt: `Relay completion advisory — not receipt or acceptance. A frozen report is available for assignment ${record.id}. Read it from shared storage using:\n${read}\nReview before acceptance. Before archival, follow Relay's generated sender-idle observation.`,
  };
  if (record.recipientHostId) args.hostId = record.recipientHostId;
  const action = { id, kind: 'advisory', tool: 'mcp__codex_app__send_message_to_thread', args };
  const observe = relay.command('record-native-result', {
    assignment: record.id, actor: report.sender, 'action-id': id, result: '<exact-tool-result.json>',
  });
  return {
    decision: 'block',
    reason: `Relay captured your final; source permission remains released. This is one notification-only continuation. Invoke the following native action exactly once, save its unmodified result outside the retained source checkout, and record it with the command below (replace only the result-file placeholder). Do not edit source, run checks, repeat an uncertain send, or emit another product report. If the tool is unavailable or errors, stop without retry; the frozen report remains readable. After recording the result, end this continuation briefly.\n${JSON.stringify(action)}\n${observe}`,
  };
}

export function idleObservation(relay, record) {
  record.idleCheck ??= { id: randomUUID() };
  const target = { threadId: record.task };
  if (record.taskHostId) target.hostId = record.taskHostId;
  return relay.response(record.report.recipient, 'none', 'Observe the exact sender now; record this fresh result before archival. Do not replay an old idle observation.', {
    status: 'SENDER_IDLE_REQUIRED',
    nativeAction: {
      id: record.idleCheck.id, kind: 'sender-idle', tool: 'mcp__codex_app__wait_threads',
      args: { targets: [target], timeoutMs: 1000 },
    },
    recordCommand: relay.command('record-native-result', {
      assignment: record.id, actor: record.report.recipient,
      'action-id': record.idleCheck.id, result: '<exact-tool-result.json>',
    }),
  });
}
