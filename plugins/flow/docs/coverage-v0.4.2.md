# Codex Flow v0.4.2 coverage

v0.4.2 is a breaking usability correction on the v0.4.1 urgent-delivery
journal. It removes two operator ambiguities without adding another lifecycle,
adapter, compatibility alias, or state migration.

## Covered

- `urgent attempt prepare` returns one bounded `host_prompt` string ready for
  the existing direct host call; no nested envelope field must be selected.
- Reconciliation accepts only the operator-facing results `sent`,
  `rejected-before-send`, and `ambiguous`.
- The removed urgent `--outcome` flag fails before journal mutation.
- `urgent observe` returns exact `consume_arguments`, including the sender
  executor ID; consumption accepts only `--sender-executor-id`.
- The removed urgent `--executor-id` flag fails before consumption.
- Attempt attribution remains immutable, dispatch remains one-shot, and the
  stored v0.4 urgent journal contract is unchanged.
- Released host-worktree packets distinguish the saved project path from the
  bound execution path and state that no upstream is expected before first
  push. Bootstrap prompts still contain no objective or execution guidance.
- The complete inherited v0.4.1 host-worktree, urgent, ordinary callback,
  integration, and cleanup behavior remains under the package test suite.

## Not claimed

- No automatic host call, outcome inference, mutable operator correction
  event, daemon, MCP service, or queue adapter.
- No compatibility aliases for the removed urgent flags or output field.
- No prevention of host replay; the journal continues to suppress duplicate
  authority at observation time.

## Held-out result

The 2026-08-25 UK Dev pilot accepted exact package revision `67d655d` through a
visible Terra/xhigh host-worktree task. The removed consume flag failed with a
byte-identical journal, the executor correctly distinguished the saved project
from its bound worktree and accepted an initially absent upstream, and one
`host_prompt` made one direct host call. Observation returned `process` plus the
exact sender-bound consume arguments; consume and ordinary callback integration
were each exactly once. Doctor, reproof, archive, and exact worktree/local/remote
cleanup passed. No natural host replay occurred, so replay remains regression
evidence rather than a held-out observation.
