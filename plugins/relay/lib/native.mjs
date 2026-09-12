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

function archivedThreadIds(value) {
  const ids = new Set();
  if (value?.archived === true && typeof value.threadId === 'string') ids.add(value.threadId);
  for (const key of ['threads', 'archivedThreads', 'items']) {
    for (const item of Array.isArray(value?.[key]) ? value[key] : []) {
      const id = item?.threadId ?? item?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
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
    const queued = objects.some(value => value.threadId === expectedThreadId);
    return {
      submissionId: actionId,
      status: queued && result.isError !== true ? 'queued' : 'ambiguous',
      nativeResultDigest: resultDigest,
    };
  }

  if (kind === 'archive') {
    requireThat(typeof expectedThreadId === 'string' && expectedThreadId.length > 0, 'Exact archived task id required');
    const archived = objects.some(value => archivedThreadIds(value).has(expectedThreadId));
    return {
      kind: 'archive', actionId, taskId: expectedThreadId,
      status: archived && result.isError !== true ? 'archived' : 'ambiguous',
      nativeResultDigest: resultDigest,
    };
  }

  if (kind === 'receipt') {
    for (const value of objects) {
      for (const poll of Array.isArray(value?.polls) ? value.polls : []) {
        if (poll?.thread?.id !== expectedThreadId) continue;
        const exactHost = !expectedHostId || poll.thread.hostId === expectedHostId;
        const exactTurn = poll?.latestTurn?.status === 'completed' && poll.latestTurn.id === expectedEventId;
        const exactText = poll.latestAssistantMessage === expectedText;
        if (exactHost && exactTurn && exactText) return {
          receiptId: actionId, status: 'received',
          taskId: expectedThreadId, hostId: poll.thread.hostId ?? null,
          eventId: poll.latestTurn.id, cursor: poll.cursor ?? null,
          textDigest: digest(poll.latestAssistantMessage),
          nativeResultDigest: resultDigest,
        };
        // An up-to-date wait cursor can suppress a final that the caller has
        // already observed. Keep a completed mismatch rereadable.
        const cursor = poll?.latestTurn?.status === 'completed' ? null : (poll.cursor ?? null);
        return {
          receiptId: actionId, status: 'pending',
          taskId: expectedThreadId, cursor,
          nativeResultDigest: resultDigest,
        };
      }
    }
    return { receiptId: actionId, status: 'pending', taskId: expectedThreadId, cursor: null, nativeResultDigest: resultDigest };
  }

  throw new Error(`Unsupported native action kind: ${kind}`);
}
