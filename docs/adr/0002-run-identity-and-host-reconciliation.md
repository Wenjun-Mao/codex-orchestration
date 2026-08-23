# ADR 0002: Run identity and host-operation reconciliation

- Status: accepted
- Date: 2026-08-23
- Scope: portable orchestration contracts and Codex host-operation safety

## Context

The first live parallel field run confirmed that ordinary terminal completion
must not re-enter an active coordinator turn. It also exposed ambiguous host
timeouts: task creation or queue delivery can appear to fail locally after the
host has already accepted work. Retrying by arrival order or UI intuition can
create duplicate tasks, integrate stale results, or target a pre-fork thread.

Task threads and hidden subagents also have materially different lifecycle and
visibility contracts. Treating them as interchangeable makes ownership and
cleanup claims unreliable.

## Decision

Version 0.2 makes execution kind, run identity, callback recipient lineage,
source revision, cleanup owner, integration reproof, and an absolute zoned
launch deadline explicit in task packets. A requested task thread may not be
satisfied by a subagent, or vice versa.

Task creation uses a repository-owned one-shot operation journal:

1. Persist a deterministic operation before invoking the host.
2. Persist an attempt and bounded ambiguity deadline before dispatch.
3. Invoke the host through the capability available to the coordinator.
4. Reconcile the observed object ID, title, execution kind, and visibility.
5. On timeout, inspect the host before authorizing another attempt.

The Node CLI does not call private model tools and does not claim that a host
operation completed merely because a local process exited successfully. Host
adapters remain capability-specific orchestration steps around the portable
journal. Version 0.2 directly journals task creation; list/read/title, send, and
archive calls use the same bounded inspect-before-retry policy but remain
host-adapter procedures rather than separate portable record types.

Terminal callbacks use immutable run identity and a durable lifecycle journal.
Transport remains at least once. Integration remains exactly once. Explicit
supersession, expiry, recipient rebinding, and observation replace arrival-order
assumptions.

Recipient rebinding is fenced. The first successful bind and each rebind return
the private fence token to their caller; idempotent bind replay, status, and
cleanup surfaces redact it. Callback observation and consumption require the
authoritative current generation.

Launch deadlines contain both an explicit-offset RFC 3339 timestamp and an IANA
timezone name. Historical validation may inspect an expired plan, but no new
host launch attempt may begin after its deadline.

## Consequences

- Coordinators can recover from ambiguous host timeouts without blind retries.
- Forked coordinators can explicitly advance recipient lineage while preserving
  callback identity and stale-packet detection.
- Monitors can compare durable lifecycle revisions and remain silent when state
  has not changed.
- The package remains dependency-free and requires no daemon, MCP server, or
  shared cross-repository database.
- Host title/sidebar visibility and compaction behavior are accepted only after
  a controlled host observation, not from schema validation alone.
- Cleanup remains audit-only. Thread archive or deletion is still outside the
  portable mutation contract.

## Rejected alternatives

- Retrying timed-out creation immediately.
- Inferring task kind from whether an ID happens to be visible in one UI.
- Hashing mutable receipt prose into the callback's delivery identity.
- Routing callbacks to the last thread ID seen in chat without lineage state.
- Adding a permanent background secretary, daemon, or MCP service.

## Field evidence

The controlled local task-creation probe is recorded in
`docs/field-tests/2026-08-23-task-creation-v0.2.md`. It accepts one projectless
visible-thread creation path and preserves the remaining host gates explicitly.
