# ADR 0042: Long-lived private task resolution

## Status

Accepted for the v0.8.2 checkpoint.

## Context

The v0.8.1 private task-ID adapter streamed the coordinator JSONL, but rejected
the file before scanning when it exceeded 256 MiB. A real long-lived
coordinator reached 876 MiB, while other retained App sessions already approach
10 GiB. The same App release also records completed MCP calls as
`mcp_tool_call_end`, not only the earlier `item_completed/McpToolCall` shape.

Codex App had created the executor and worktree, but the public task catalog did
not expose its ready ID. Retrying, matching by title/path/recency, or mutating
the v0.8.1 snapshot would violate the one-shot and immutable-runtime contracts.

## Decision

Source coordinator sessions are scanned sequentially with a reviewed 16 GiB,
one-million-line, and 32 MiB-per-line envelope. The first metadata row and
canonical filename bind the current coordinator identity; repeated current-task
metadata and embedded ancestor metadata from a forked long-lived history are
allowed. The scanner retains only that primary identity, one compact matching
completion, and bounded counters while continuing through the initial bounded
prefix for its digest and duplicate detection. It immediately re-hashes that
same prefix through the opened descriptor. Append-only suffix growth is
permitted because an active coordinator continues recording while recovery
runs; truncation, replacement, or any prefix-digest difference fails closed.

Both known completed-call shapes are accepted. The older shape must carry its
source thread ID. The newer shape omits that field and is bound instead by the
unique canonical source session whose `session_meta` equals the persisted
coordinator task. Both retain exact bootstrap, title, model, effort, placement,
host result, provisional ID, event-window, global binding, child-session,
selector, and delegation checks.

v0.8.2 also provides one read-only recovery adapter for exact v0.8.1 source
authority. It authenticates the v0.8.1 lifecycle and content-addressed runtime
through that snapshot's refresh exporter, reads the exact provisional operation
and App evidence, and writes an unwrapped reconcile request outside the
repository. Only the immutable v0.8.1 CLI may consume that request and mutate
the source run. The bridge supports no other predecessor and performs no task
creation, retry, binding, release, refresh, or state migration.

The emitted source-reconciliation command names the current Node executable
and passes the immutable snapshot CLI as its first argument. Runtime bundle
materialization preserves authenticated bytes but does not promise executable
file modes, so the snapshot `.mjs` path is never presented as a directly
executable program. v0.8.3 adds this invocation correction and executes the
emitted pair in the exact-v0.8.1 regression.

## Rejected alternatives

- Increase the cap while continuing to retain matching raw rows. That leaves an
  avoidable memory-growth path.
- Scan only a tail or correlate by task title, path, or time. Those shortcuts
  cannot prove full-file uniqueness under the existing evidence contract.
- Add a local index or daemon. Current App JSONL has no authenticated append
  chain or authoritative index, so the cache would introduce another trust
  system without eliminating the source scan.
- Hot-switch the active run to v0.8.2. Source mutations remain owned by the
  exact runtime snapshot that admitted the run.

## Consequences and exit condition

Resolution remains O(source-session bytes) but O(maximum-line bytes) in memory.
Large histories may therefore take longer to authenticate, but the scan is
finite and preserves existing evidence semantics. Focused tests cover the
reviewed bound, both App event shapes, duplicate rejection, exact-source bridge,
coordinator identity, and no source-state mutation.

Retire the private adapters when Codex App exposes a public, operation-bound
mapping from provisional client ID to ready task ID with equivalent bootstrap,
selector, and event evidence.
