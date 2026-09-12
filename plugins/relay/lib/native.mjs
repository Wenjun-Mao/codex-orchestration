import { digest } from './source.mjs';
import { requireThat } from './store.mjs';

function parsedObjects(result) {
  const objects = [];
  if (result?.structuredContent && typeof result.structuredContent === 'object') objects.push(result.structuredContent);
  for (const block of result?.content ?? []) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const value = JSON.parse(block.text);
      if (value && typeof value === 'object') objects.push(value);
    } catch {
      // Human-readable tool output cannot mechanically establish a native fact.
    }
  }
  return objects;
}

// App responses may omit hostId. In that case the exact generated request owns
// routing; an explicit contradictory host in the response is never acceptable.
function hostMatches(value, expectedHostId) {
  return !expectedHostId || value?.hostId == null || value.hostId === expectedHostId;
}
function archivedThreadIds(value, expectedHostId) {
  const ids = new Set();
  if (!hostMatches(value, expectedHostId)) return ids;
  if (value?.archived === true && typeof value.threadId === 'string') ids.add(value.threadId);
  for (const key of ['threads', 'archivedThreads', 'items']) {
    for (const item of Array.isArray(value?.[key]) ? value[key] : []) {
      const id = item?.threadId ?? item?.id;
      if (typeof id === 'string' && hostMatches(item, expectedHostId)) ids.add(id);
    }
  }
  return ids;
}

function pendingReceipt(actionId, taskId, polls, nativeResultDigest) {
  // An up-to-date wait cursor can suppress a final that the caller has already
  // observed. Keep completed or conflicting observations rereadable.
  const cursor = polls.some(poll => poll?.latestTurn?.status === 'completed')
    ? null : (polls.find(poll => typeof poll?.cursor === 'string')?.cursor ?? null);
  return { receiptId: actionId, status: 'pending', taskId, cursor, nativeResultDigest };
}

export function normalizeNativeResult({
  kind, actionId, result, expectedThreadId = null,
  expectedHostId = null, expectedEventId = null, expectedText = null,
}) {
  requireThat(typeof actionId === 'string' && actionId.length > 0, 'Exact prepared native action id required');
  requireThat(result && typeof result === 'object' && !Array.isArray(result), 'Exact native tool result object required');
  const objects = parsedObjects(result);
  const resultDigest = digest(JSON.stringify(result));

  if (kind === 'create') {
    const ready = objects.find(value => typeof value.threadId === 'string' && value.threadId.length > 0);
    if (ready && result.isError !== true) return {
      actionId, status: 'ready', taskId: ready.threadId,
      hostId: typeof ready.hostId === 'string' ? ready.hostId : null,
      clientThreadId: typeof ready.clientThreadId === 'string' ? ready.clientThreadId : null,
      nativeResultDigest: resultDigest,
    };
    const provisional = objects.find(value => typeof value.clientThreadId === 'string' && value.clientThreadId.length > 0);
    if (provisional && result.isError !== true) return {
      actionId, status: 'provisional', clientThreadId: provisional.clientThreadId,
      hostId: typeof provisional.hostId === 'string' ? provisional.hostId : null,
      nativeResultDigest: resultDigest,
    };
    return { actionId, status: 'ambiguous', nativeResultDigest: resultDigest };
  }

  if (kind === 'report') {
    const queued = objects.some(value => value.threadId === expectedThreadId)
      && objects.every(value => hostMatches(value, expectedHostId));
    return {
      submissionId: actionId,
      status: queued && result.isError !== true ? 'queued' : 'ambiguous',
      nativeResultDigest: resultDigest,
    };
  }

  if (kind === 'archive') {
    requireThat(typeof expectedThreadId === 'string' && expectedThreadId.length > 0, 'Exact archived task id required');
    const noConflict = objects.every(value => hostMatches(value, expectedHostId)
      && ['threads', 'archivedThreads', 'items'].every(key =>
        (Array.isArray(value?.[key]) ? value[key] : []).every(item =>
          (item?.threadId ?? item?.id) !== expectedThreadId || hostMatches(item, expectedHostId))));
    const archived = noConflict && objects.some(value => archivedThreadIds(value, expectedHostId).has(expectedThreadId));
    return {
      kind: 'archive', actionId, taskId: expectedThreadId,
      status: archived && result.isError !== true ? 'archived' : 'ambiguous',
      nativeResultDigest: resultDigest,
    };
  }

  if (kind === 'sender-idle') {
    requireThat(typeof expectedThreadId === 'string' && expectedThreadId.length > 0, 'Exact sender task required');
    const polls = objects.flatMap(value => Array.isArray(value?.polls) ? value.polls : []);
    const idle = result.isError !== true && polls.length > 0 && polls.every(poll =>
      poll?.schemaVersion === 1 && poll.thread?.id === expectedThreadId
      && (!expectedHostId || poll.thread.hostId === expectedHostId)
      && ['idle', 'notLoaded'].includes(poll.thread.status?.type)
      && ['completed', 'interrupted', 'failed'].includes(poll.latestTurn?.status)
      && typeof poll.latestTurn.id === 'string' && poll.latestTurn.id.length > 0);
    return { actionId, taskId: expectedThreadId, status: idle ? 'idle' : 'pending', nativeResultDigest: resultDigest };
  }

  if (kind === 'receipt') {
    const polls = objects.flatMap(value => Array.isArray(value?.polls) ? value.polls : [])
      .filter(poll => poll?.thread?.id === expectedThreadId);
    const observations = polls.map(poll => {
      const message = poll.latestAssistantMessage;
      const exactHost = !expectedHostId || poll.thread.hostId === expectedHostId;
      const exactTurn = poll.schemaVersion === 1 && poll?.latestTurn?.status === 'completed'
        && poll.latestTurn.id === expectedEventId && poll.latestTurn.error === null;
      const exactMessage = message && typeof message === 'object' && !Array.isArray(message)
        && typeof message.id === 'string' && message.id.length > 0
        && poll.latestAssistantMessageId === message.id
        && message.turnId === expectedEventId && message.turnId === poll.latestTurn?.id
        && message.phase === 'final_answer'
        && typeof message.text === 'string' && message.text === expectedText;
      return { poll, message, exact: exactHost && exactTurn && exactMessage };
    });
    const signatures = new Set(observations.map(({ poll, message }) => JSON.stringify({
      hostId: poll.thread.hostId ?? null,
      turnId: poll.latestTurn?.id ?? null,
      turnStatus: poll.latestTurn?.status ?? null,
      turnError: poll.latestTurn?.error ?? null,
      latestAssistantMessageId: poll.latestAssistantMessageId ?? null,
      messageId: message?.id ?? null,
      messageTurnId: message?.turnId ?? null,
      messagePhase: message?.phase ?? null,
      messageText: message?.text ?? null,
    })));
    if (result.isError === true || observations.length === 0
      || observations.some(observation => !observation.exact) || signatures.size !== 1) {
      return pendingReceipt(actionId, expectedThreadId, polls, resultDigest);
    }
    const { poll, message } = observations[0];
    return {
      receiptId: actionId, status: 'received',
      taskId: expectedThreadId, hostId: poll.thread.hostId ?? null,
      eventId: poll.latestTurn.id, cursor: poll.cursor ?? null,
      textDigest: digest(message.text),
      nativeResultDigest: resultDigest,
    };
  }

  throw new Error(`Unsupported native action kind: ${kind}`);
}
