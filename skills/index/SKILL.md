---
name: index
description: Route Codex Flow questions, coordinator refresh, native-first orchestration, result integration, cleanup, and unplug. Use when the user asks about or wants to use Codex Flow, or when work may benefit from multiple separate Codex tasks.
---

# Codex Orchestration Router

Route by intent before changing repository state.

- Answer questions, audits, and plans read-only. Repository setup is not needed.
- Before actionable coordination, invoke `codex-orchestration:refresh` once.
  A fresh route continues with `codex-orchestration:coordinate`; a source run
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

v0.9 requires no tracked setup and does not read, write, or validate repository
or global instruction files. It has no general predecessor migration. Its only
cross-release path is the bounded authenticated v0.8 semantic refresh export.
