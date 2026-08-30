# Codex Orchestration v0.7 boundary

Status: current v0.7 package and runtime boundary.

This document summarizes the breaking v0.7 authority established by
[ADR 0015](adr/0015-progressive-run-activation-authority.md) through
[ADR 0029](adr/0029-v070-clean-authority-cutover.md).

## Retained cross-task authority

- Authenticated repository baseline, coordinator lineage, and path, resource,
  and branch reservation envelopes.
- One content-addressed workflow DAG with generated task contracts.
- Explicit configured, requested, accepted, observed, and unavailable model and
  reasoning evidence.
- One-shot visible-task creation with opaque provisional identity and
  nonce-authenticated ready identity.
- Quiet durable routine results and separately journaled urgent interrupts.
- Exactly-once coordinator disposition, serial Git integration, combined
  verification, archive reconciliation, terminal run audit, and deterministic
  read-only cleanup planning.
- Native subagents as a separate bounded read-only lane with explicit selectors
  and unchanged-Git disposal proof.

## Native primitives consumed directly

- Codex App projects and separate visible task creation.
- Native model/reasoning selection and host-managed worktrees.
- Native messaging, waiting, Handoff, status, archive, and managed-worktree
  lifecycle.
- Native subagents for read-only supporting work.

Native waits and task finals provide liveness only. They do not replace the
durable result journal or coordinator disposition.

## Current v0.7 contract

- Read-only questions and plans require no repository setup.
- An authorized actionable request may progressively activate one explicit run
  under `.git/codex-flow/v0.7.0/`, with an exact runtime snapshot and
  disclosure before external task creation.
- Activation writes no tracked setup, adoption, instructions, or `AGENTS.md`.
- A bounded foreign-active-run sentinel checks sibling version namespaces at
  admission. A non-null foreign `active_run_id` blocks v0.7; malformed,
  symlinked, oversized, or excessively numerous sibling lifecycle namespaces
  fail closed.
- Immutable workflow revisions bind run, runtime/configuration, repository and
  common directory, coordinator, baseline, dependencies, ownership, exclusive
  resources, and model routing.
- Every task states primary outcome, nullable causal question, cheapest safe
  direct attempt, and instrument role. Supporting instrumentation must lead to
  the direct attempt or pause/replan after one checkpoint.
- Every native call uses explicit model and reasoning selectors. Native
  subagents also use bounded `fork_turns`; full-history inheritance and Ultra
  are forbidden for that lane.
- A selector rejected before any native identity consumes the one-shot
  operation and may authorize exactly one content-addressed child revision with
  new selectors. Ambiguity or any native identity remains fail-closed.
- Objective delivery is an at-most-once release accepted only from the exact
  persisted pristine executor worktree, reserved branch, run-bound runtime,
  common directory, and generated contract.
- Terminal receipt v3 derives `unchanged`, `clean-commit`, or
  `dirty-blocked`; upstream is nullable and missing host selector observation
  remains null.
- Routine visible-task completion writes only the Git-common callback journal.
  Urgent blockers persist before one bounded direct interrupt attempt.
- The terminal chain is result -> prepared disposition -> integration or
  no-change -> content-addressed PASS combined verification -> finalized
  disposition/internal consumption -> reconciled archive -> cleanup plan ->
  independently resolved Git refs and worktrees -> terminal run audit.
- Archive cleanliness treats tracked and ordinary untracked changes as source
  risk while permitting ignored generated output.
- Cleanup remains read-only: v0.7 derives exact eligibility but does not delete
  branches, worktrees, refs, runtime snapshots, or operational journals.

## Clean predecessor boundary

No predecessor reader, mutator, migration, retirement, or tracked-adoption
command is packaged in v0.7. The active CLI, runtime bundle, schemas, skills,
tests, examples, and package documentation use only v07 identities.

Predecessor versions remain available through immutable source tags and Git
history, not through the current artifact. Their operational namespaces are not
imported or normalized into v0.7. The only cross-version read is the bounded
foreign-active-run sentinel's minimal sibling `runs/lifecycle.json` check at
admission.

A predecessor run must be completed or explicitly abandoned under its own
snapshotted runtime before v0.7 can activate. Deleting old local journals is a
separate, exact, user-approved post-acceptance action; v0.7 never does it.

## Retired mechanisms

- Mandatory `.codex/orchestration/` setup as a delegation gate.
- Tracked runtime adoption and plugin-managed instruction files.
- Any plugin read or write of `AGENTS.md`.
- Predecessor verification, retirement, migration, and mutator commands.
- Independently authored parallel plans and task packets.
- Title/time correlation of asynchronous task creation.
- Blind creation or release retry after ambiguity.
- Direct message or Steer for routine completion.
- Task-final, UI-state, raw-digest, or branch-name integration authority.
- Visible-task Git/callback lifecycle for native subagents.
- Full-history native-subagent forks paired with explicit selector overrides.
- Caller-authored leases and operation fences from predecessor protocols.
- Public bare callback consumption and Git cleanup application.

## Verification authority

`npm run test:v07` runs the current v0.7 runtime suite plus shared recipient,
release-identity, and selector contracts. `npm test` aliases that current
suite; it does not execute predecessor code from historical tags.

`npm run validate` enforces the exact current schema/example inventory,
predecessor-free package surface, skill and template markers, version/state
namespace parity, zero third-party dependencies, and release identity.
`npm run pack:check` inspects the exact npm artifact. Plugin and skill
validation are additional release gates.
