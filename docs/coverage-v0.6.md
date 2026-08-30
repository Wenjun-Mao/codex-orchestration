# Codex Orchestration v0.6 boundary

Status: accepted v0.6.5 boundary.

This document summarizes the v0.6 contract established by
[ADR 0015](adr/0015-progressive-run-activation-authority.md) through
[ADR 0028](adr/0028-archive-cleanliness-excludes-ignored-output.md).
The accepted source and personal-marketplace package are v0.6.5.

## Retained cross-task authority

- Authenticated repository baseline, coordinator lineage, path/resource/branch
  reservation envelopes, and DAG-ordered shared-resource gates.
- Explicit requested/accepted/observed model and reasoning evidence.
- Quiet durable routine results and separately journaled urgent interrupts.
- Exactly-once coordinator disposition, serial Git integration, combined
  verification, archive reconciliation, and deterministic read-only cleanup
  planning. v0.6 does not apply Git deletion.

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
  under `.git/codex-flow/v0.6.5/`, with an exact runtime snapshot and disclosure
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
- Visible task creation is one-shot. The host's provisional ID is bounded
  opaque evidence stored verbatim; provisional and ready IDs remain separate,
  and the ready identity must expose the exact launch nonce in its initial
  host-visible user turn.
- Objective delivery is an at-most-once release handshake accepted only from
  the exact persisted pristine executor worktree and reserved branch, through
  the run-bound runtime, for the exact contract, common directory, and ready
  task.
- Terminal receipt v3 derives `unchanged`, `clean-commit`, or `dirty-blocked`;
  upstream is nullable.
- A terminal receipt becomes durable only after callback admission matches its
  accepted release, ready task, baseline, and exact selector evidence. Missing
  host observation remains null and is never inferred from requested or
  accepted selectors.
- The visible-task terminal chain is result -> prepared disposition -> integration or
  no-change -> content-addressed PASS combined verification -> finalized
  disposition/internal consumption -> reconciled archive -> cleanup plan ->
  independently resolved Git refs/worktrees. Cleanup application is a later
  checkpoint.
- Native subagents instead close through `complete` and accepted `dispose`
  records with unchanged-Git evidence; they never enter the visible-task
  callback/integration/archive chain.
- Archive preparation treats tracked and ordinary untracked changes as source
  risk but permits Git-ignored generated output to remain until the host removes
  the worktree.

## Retired mechanisms

- Mandatory `.codex/orchestration/` setup as the delegation entry gate.
- Independently authored parallel plans and task packets.
- Title/time correlation of asynchronous task creation.
- Blind creation or release retry after ambiguity.
- Direct message/Steer for routine completion.
- Task-final, UI-state, raw-digest, or branch-name integration authority.
- Visible-task Git/callback lifecycle for native subagents.
- Full-history native-subagent forks paired with explicit model/effort
  overrides; bounded forks preserve current host selector compatibility.
- v0.5 TTL leases and caller-authored operation fences in the v0.6 runtime.
- Git cleanup apply; v0.6 exposes a read-only exact-state plan only.
- Public bare callback consumption.
- v0.5 compatibility readers or operational-state migration.

## Tracked-authority transition boundary

- Tracked v0.6 adoption promotes the exact runtime of an already active run;
  it is not a standalone initial setup engine.
- `adopt retire-plan|retire-apply` retires a tracked v0.6 adoption only.
- `adopt legacy-retire-plan|legacy-retire-apply` handles accepted tracked
  v0.5.1 through a separate exact plan/apply. It removes only predecessor-owned
  tracked authority, never applies automatically, and leaves the repository
  eligible for setup-free v0.6 activation.
- The v0.5.1 tag, package/cache identity, tasks, Git state, branches, worktrees,
  and `.git/codex-flow/v0.5.1/` evidence remain byte-preserved. No predecessor
  record is imported into v0.6.
- Other predecessor versions and run-independent initial tracked-v0.6 adoption
  remain deferred.

Accepted v0.5.1 tests run only from its immutable tag; predecessor fixtures are
not shipped as active v0.6 package authority.
`npm run test:v06` runs the active v0.6 suite plus shared recipient,
urgent-signal, and release-identity contracts. `npm run test:v05.1` authenticates
the immutable accepted tag/commit, extracts it outside the repository, and runs
its complete predecessor suite against its own CLI. `npm test` runs both
version-authoritative suites; it does not execute historical v0.5 mutation
tests against the breaking v0.6 CLI.
