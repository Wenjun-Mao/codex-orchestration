# Codex Orchestration v0.6 development boundary

Status: accepted design boundary; implementation and release acceptance remain
separate checkpoints.

This document summarizes the v0.6 contract established by
[ADR 0015](adr/0015-progressive-run-activation-authority.md) and
[ADR 0016](adr/0016-content-addressed-workflow-and-native-boundary.md). It does
not claim that the installed marketplace package has moved beyond v0.5.1.

## Retained cross-task authority

- Authenticated repository baseline, coordinator lineage, path/resource/branch
  ownership, leases, and shared-resource gates.
- Explicit requested/accepted/observed model and reasoning evidence.
- Quiet durable routine results and separately journaled urgent interrupts.
- Exactly-once coordinator disposition, serial Git integration, combined
  verification, archive reconciliation, and proof-based cleanup.

## Native primitives consumed directly

- Codex App projects and separate visible task creation.
- Native model/reasoning selection and host-managed worktrees.
- Native messaging, waiting, Handoff, status, archive, and managed-worktree
  lifecycle.
- Native subagents as a separate read-only supporting surface.

Native waits and task finals provide liveness only. They do not replace the
durable result journal or coordinator disposition.

## Breaking redesign

- A read-only question or plan never requires tracked repository setup.
- An authorized actionable request may progressively activate one explicit run
  under `.git/codex-flow/v0.6.0/`, with an exact runtime snapshot and disclosure
  before external task creation.
- Permanent tracked adoption is optional and uses the same engine. Existing
  tracked v0.5 authority must be explicitly retired; its evidence is preserved
  and never imported.
- One content-addressed workflow generates all task contracts. Immutable
  revisions bind run, runtime/configuration, repository/common directory,
  coordinator, baseline, dependencies, ownership, and model routing.
- Every task states primary outcome, causal question, cheapest safe direct
  attempt, and instrument role. A supporting instrument must lead immediately
  to its direct attempt or pause/replan; another supporting checkpoint needs
  explicit later authorization.
- Visible task creation is one-shot. Provisional and ready IDs remain separate,
  and the ready identity must expose the exact launch nonce in its initial
  host-visible user turn.
- Objective delivery is an at-most-once release handshake whose exact contract,
  runtime, common directory, and ready task must be accepted before work.
- Terminal receipt v3 derives `unchanged`, `clean-commit`, or `dirty-blocked`;
  upstream is nullable.
- The terminal chain is result -> prepared disposition -> integration or
  no-change -> content-addressed PASS combined verification -> finalized
  disposition/internal consumption -> reconciled archive -> proof-based Git
  cleanup.

## Retired mechanisms

- Mandatory `.codex/orchestration/` setup as the delegation entry gate.
- Independently authored parallel plans and task packets.
- Title/time correlation of asynchronous task creation.
- Blind creation or release retry after ambiguity.
- Direct message/Steer for routine completion.
- Task-final, UI-state, raw-digest, or branch-name integration authority.
- Visible-task Git/callback lifecycle for native subagents.
- Public bare callback consumption.
- v0.5 compatibility readers or operational-state migration.

Historical v0.5 coverage documents, examples, and field tests remain useful
evidence of the accepted predecessor but are not active v0.6 guidance.
