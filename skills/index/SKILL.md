---
name: index
description: Route Codex Flow direction, coordinator refresh, native-first orchestration, result integration, cleanup, and unplug. Use when the user asks about or wants to use Codex Flow, or when work may benefit from directed delegation or multiple separate Codex tasks.
---

# Codex Orchestration Router

Route by intent before changing repository state.

- Use `codex-orchestration:direct` when the task owns goals, strategic
  conversation, tradeoffs, assignments, and acceptance. It may perform bounded
  direct work or delegate delivery; it does not force a fixed task count.
- Use `codex-orchestration:plan` when the director and user must settle and
  save outcome, scope, tradeoffs, acceptance, authority, or escalation before
  delivery. The plan skill may persist a planning document in ordinary mode;
  it does not implement product changes.
- Answer questions and audits read-only. A planning request that is intended to
  authorize later delivery must use the durable plan contract before dispatch.
- Before actionable coordination, invoke `codex-orchestration:refresh` once.
  A fresh delegated-delivery route continues with
  `codex-orchestration:coordinate`; a source run
  resumes through its immutable runtime; a ready cutover stays in the refresh
  skill; ambiguous authority stops.
- Use `codex-orchestration:execute` inside a visible executor whose first-turn
  assignment contains its exact launch command and full contract.
- Use `codex-orchestration:integrate` for durable results, dispositions,
  integration/no-change proof, verification, and archival.
- Use `codex-orchestration:cleanup` for a read-only exact-state cleanup plan.
- Use `codex-orchestration:unplug` only for an approved repository clean start.

Choose the native surface before model routing. Keep sequential or shared
evolving state in one coordinator. Native subagents are bounded read-only
supporting lanes. Visible tasks are independent mutating lanes with durable Git
lifecycle. Never silently substitute one surface for another.

For a director, “Implement the plan” routes to
`codex-orchestration:plan` to persist and bind the approved revision, then to
`codex-orchestration:direct` for one bounded coordinator dispatch and return.
The director does not implement locally or enter a `wait_threads` monitoring
loop. The coordinator receives the real approved assignment in its initial
prompt and owns delivery and technical recovery. Its complete result returns
to exactly one named recipient/path for review; delivery is not acceptance.

v0.9 requires no tracked setup and does not read, write, or validate repository
or global instruction files outside the explicit planning document requested by
the user. It has no general predecessor migration. Its only cross-release path
is the bounded authenticated v0.8 semantic refresh export.
