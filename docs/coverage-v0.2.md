# v0.2 orchestration coverage

This records the portable package boundary against findings from the first
multi-thread Yindian field run. It is an implementation scorecard, not a claim
that every Codex host has the same capabilities.

## Covered

- Task packets distinguish visible `task-thread` from hidden `subagent` and
  fail closed on substitution.
- Ordinary terminal completion uses a durable queue journal; only blockers,
  approvals, and high-risk drift use Steer.
- Callback IDs are deterministic; retries retain identity; observed/consumed
  state provides exactly-once integration over at-least-once transport.
- Callback lifecycle includes persisted, enqueue-attempted, enqueued, observed,
  consumed, superseded, and expired.
- Explicit sequence supersession replaces arrival-order authority.
- Receipt fields, size, accounting, and sensitive-content rules are closed and
  fail closed.
- Recipient lineage, thread, generation, and fenced rebinding survive an
  explicit fork/resume handoff.
- Task plans validate DAG closure, exact write ownership, dependencies,
  exclusive resources, serial gates, and concurrency.
- Task creation uses deterministic operation IDs, bounded attempts,
  inspect-before-retry reconciliation, exact title/kind/visibility checks, and
  absolute zoned launch deadlines.
- Cleanup is audit-first, idempotent, and coordinator-owned; portable code does
  not delete or archive.
- The runtime and plugin remain dependency-free `.mjs` and work in non-JavaScript
  repositories.

## Partial

- The operation journal directly models task creation. Host list/read/title,
  send, and archive calls follow the same documented policy but do not yet have
  dedicated portable record types.
- Revision staleness uses explicit same-lineage/executor/run supersession. It
  does not run repository ancestry queries across arbitrary remote hosts.
- Monitors can deduplicate by callback ID and durable state, but no permanent
  monitor service is shipped.
- Cleanup reports retained lifecycle records and legacy v0.1 state; retention
  and deletion remain human decisions.

## Host-dependent or unverified

- Task creation, list/read, title, archive, and message calls are performed by
  a capable coordinator session; the CLI cannot invoke private model tools.
- Role/skill/file retention through compaction, resume, and fork varies by host
  and needs controlled host acceptance before reliance.
- Sidebar visibility and title correctness require direct host inspection.

## Intentionally excluded

- Daemon, MCP server, background secretary, shared cross-repository database,
  automatic task deletion, automatic worktree removal, and silent task-kind
  fallback.
