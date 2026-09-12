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

export function normalizeNativeResult({
  kind, actionId, result, expectedThreadId = null,
  expectedHostId = null,
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

  throw new Error(`Unsupported native action kind: ${kind}`);
}
