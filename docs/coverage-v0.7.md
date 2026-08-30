# Codex Orchestration v0.7 boundary

Status: current v0.7 package and runtime boundary.

This document summarizes the breaking v0.7 authority established by
[ADR 0015](adr/0015-progressive-run-activation-authority.md) through
[ADR 0031](adr/0031-clean-start-unplug-boundary.md) and
[ADR 0032](adr/0032-detached-codex-app-worktree-unplug.md), with opaque-state
planning refined by [ADR 0033](adr/0033-opaque-root-state-unplug-plans.md) and
host-ref identity refined by
[ADR 0034](adr/0034-host-managed-turn-diff-ref-authority.md), and detached
worktree binding refined by
[ADR 0035](adr/0035-detached-host-worktree-bind-checkpoint.md).

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
  under `.git/codex-flow/v0.7.5/`, with an exact runtime snapshot and
  disclosure before external task creation.
- Activation writes no tracked setup, adoption, instructions, or `AGENTS.md`.
- A bounded sibling-namespace sentinel checks Git-common state at admission.
  Any incompatible namespace requires a clean start; a non-null foreign
  `active_run_id` additionally proves that unplug cannot begin. Malformed,
  symlinked, oversized, or excessively numerous sibling state fails closed.
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
- A ready host-worktree task persists content-addressed binding intent before
  the detached worktree is attached to its reserved branch. Both interruption
  windows recover only from that exact intent, preserve preparation chronology,
  and reject the active runtime coordinator root as an executor target.
- Objective delivery is an at-most-once release prepared only after fresh live
  authentication of completed binding and accepted only from the exact
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
- Ordinary run cleanup remains read-only: v0.7 derives exact eligibility but
  does not expose a run-scoped cleanup mutation. The separate clean-start
  `unplug` lifecycle may apply only its unchanged, explicitly approved
  repository plan after exact task-archive evidence.

## Clean predecessor boundary

The editable authority is `0.7.5-dev.0`. It uses the
`.git/codex-flow/v0.7.5/` namespace and does not migrate, reinterpret, delete,
or overwrite accepted v0.7.4 state or content-addressed runtime snapshots under
`.git/codex-flow/v0.7.4/`.

No predecessor reader, mutator, migration, retirement, or tracked-adoption
command is packaged in v0.7. The active CLI, runtime bundle, schemas, skills,
tests, examples, and current-boundary documentation use only v07 identities;
historical ADRs remain decision evidence. `unplug` is a version-agnostic local
cleanup lifecycle; it does not interpret, rehabilitate, or execute a
predecessor protocol.

Predecessor versions remain available through immutable source tags and Git
history, not through the current artifact. Their operational namespaces are not
imported or normalized into v0.7. Admission's only cross-version read is the
bounded foreign-active-run sentinel's minimal sibling `runs/lifecycle.json`
check. The version-agnostic unplug planner separately hashes opaque retained
state without interpreting it. It can resume its own exact v0.7.2 plan-v1
journal, but emits only plan v2 for new clean starts.

A predecessor run must be completed or explicitly abandoned under its own
snapshotted runtime before v0.7 can activate.

## Clean start and unplug

An incompatible Flow namespace is an admission failure, not a request to
reinterpret retained state. `unplug plan` is read-only and repository-scoped:
it binds the repository and Git common directory, inventories exact namespace
directories and ordinary root files, and identifies every task that must first
be reconciled and archived through the App. Opaque files are authenticated by
exact path, size, and byte digest but never parsed or migrated.

Only after those tasks are archived may `unplug apply` use the unchanged plan,
and only after explicit user approval. Apply is local-only: it may remove only
exact planned Flow paths, tracked-clean same-common-directory linked
worktrees (including detached Codex App task worktrees whose tips are already
ancestral to the authenticated base), and unprotected local `codex/*` branches already ancestral to the
authenticated base. Git-ignored artifacts do not block that worktree check;
tracked or ordinary-untracked changes, unmerged or attached branches,
protected resources, remote state, and path or tip drift do. It never deletes
remote refs, tags, source history, or unrelated Git-common files. All planned
`.git/codex-flow` state is deleted last: opaque files non-recursively and
namespace directories recursively, with type and content revalidated. A
crash-resume journal outside that state root blocks new activation until the
exact operation resumes; both the Flow state root and journal must have zero
residue before a clean start is reported. Optional App-plugin uninstallation
is a separate explicit user action after that confirmation.

Unplug repository identity excludes only host-managed
`refs/codex/turn-diffs/` capture refs, which Codex App may create between an
approved plan and apply. Local heads, Flow cleanup branches, remotes, tags,
other Codex refs, worktrees, source status, planned resource tips, and exact
state bytes remain fail-closed authority.

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
- Public bare callback consumption and ordinary run-scoped Git cleanup
  application.

## Verification authority

`npm run test:v07` runs the current v0.7 runtime suite plus shared recipient,
release-identity, and selector contracts. `npm test` aliases that current
suite; it does not execute predecessor code from historical tags.

`npm run validate` enforces the exact current schema/example inventory,
predecessor-free package surface, skill and template markers, version/state
namespace parity, zero third-party dependencies, and release identity.
`npm run pack:check` inspects the exact npm artifact. Plugin and skill
validation are additional release gates.
