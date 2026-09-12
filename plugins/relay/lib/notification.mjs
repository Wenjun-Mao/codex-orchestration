import { randomUUID } from 'node:crypto';

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
