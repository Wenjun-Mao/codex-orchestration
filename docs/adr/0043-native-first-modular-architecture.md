# ADR 0043: Native-first modular architecture

- Status: accepted for v0.9 implementation
- Date: 2026-09-04
- Supersedes: current-package bootstrap/release mechanics and open-ended
  predecessor compatibility in ADRs 0035, 0037, 0040, 0041, and 0042 where
  explicitly stated below

## Context

The v0.8 visible-task protocol spent an entire executor model turn displaying a
nonce-only bootstrap, then waited for coordinator-side ready-ID resolution and
branch binding before a second message delivered the assignment. Real App runs
showed minutes of nonproductive time and token use. It also coupled durable
workflow rules to changing App result fields, private session recovery, current
model names, and predecessor-specific bridges.

The safety purpose was valid: no executor could mutate source before its exact
identity, runtime, linked worktree, baseline, and branch were authenticated.
The sequencing mechanism was not. The process with the earliest reliable
access to both real task identity and actual worktree is the executor itself.

Repeated post-release failures also showed that internal transition tests did
not sufficiently cover real App return shapes, linked Git topology, whole
lifecycle joins, exact predecessor packages, and App turn boundaries.

## Decision

v0.8.3 is maintenance-only. v0.9 starts an exact new namespace and contains
three explicit layers plus finite compatibility capsules:

1. a Stable Flow governance core;
2. a Codex App adapter producing versioned typed evidence; and
3. a Replaceable routing policy.

Every packaged module is classified exactly once in a machine-enforced
module-layer registry. Core may import only core. Policy and adapter may depend
on core but not each other. Compatibility may depend on public adapter/core
contracts; no stable layer depends on compatibility.

For visible tasks, the full generated contract is the first prompt. The prompt
includes a content-addressed launch, nonce, and exact executor start command.
The executor runs that deterministic command before source access. It
authenticates `CODEX_THREAD_ID`, the immutable runtime, contract, nonce,
repository common directory, pristine baseline, non-coordinator worktree, and
reserved branch; persists branch-binding intent; attaches the branch; and
revalidates. Useful work continues in the same turn.

Creation remains one-shot. Direct ready, provisional, and unknown future return
shapes are recorded as typed evidence. An exact executor start claim can
establish ready identity independently; known host identity must agree.
Project/title matching never establishes identity. Normal launch performs no
private history scan.

The bootstrap-only turn, coordinator `task create bind`, separate release
message, and release lifecycle leave current authority. A terminal receipt v4
binds downstream lifecycle state directly to `launch_id`.

Routing chooses execution surface first and then returns explicit model,
reasoning effort, and rationale. These values remain replaceable policy data,
not core architecture or automatic learned routing.

v0.9 retains exactly three compatibility capsules: authenticated v0.8 semantic
refresh export, bounded provisional-to-ready mapping for archival of a task
that never starts, and private archive observation. The v0.7.8 refresh and
v0.8.1 recovery bridges remain available only from immutable tags.

## Rejected alternatives

- **Keep bootstrap and merely shorten its text.** This preserves the wasted
  executor turn and second-message latency.
- **Trust the assignment prompt to wait while the coordinator binds.** This
  still permits source access before a host-enforced gate.
- **Require a new dormant-task App primitive.** Such a primitive would be
  useful, but current App behavior does not expose one and the executor start
  gate already has the necessary identity and worktree context.
- **Infer ready identity from project, title, recency, or path.** These fields
  are non-unique and cannot authenticate a one-shot operation.
- **Keep every historical bridge for convenience.** This recreates a growing
  migration framework and repeats cross-version defects.
- **Place model names in core.** Models and costs evolve independently of
  workflow safety.

## Consequences

- A visible executor begins useful work in its first model turn after a local,
  deterministic activation gate.
- The App may return a provisional or unfamiliar result without blocking an
  executor that can make an exact start claim.
- A task that never starts remains unactivated and may require the bounded
  mapping capsule solely for archival.
- Branch attachment moves from coordinator sequencing to executor activation;
  crash recovery around pre-switch and post-switch boundaries must remain
  idempotent.
- v0.8 active runs remain immutable and may cross only through their semantic
  refresh exporter. Other predecessors require explicit clean start.
- Policy changes can be evaluated and released without changing governance
  state semantics.

## Guardrails

- Pure core tests contain no App fixtures.
- Adapter fixtures cover direct, provisional, opaque, duplicate, contradictory,
  and archive-lag evidence.
- Real-Git tests cover pristine activation, negative identity/repository/Git
  cases, and every crash boundary around branch attachment.
- Complete lifecycle tests join launch through callback, disposition,
  integration/no-change, verification, archive, cleanup, and audit.
- Exact predecessor compatibility tests invoke immutable v0.8.3 authority.
- App-facing stable promotion requires a same-coordinator live RC canary that
  proves one initial prompt, same-turn work, no release message, and separate
  App provisioning versus Flow activation timing.
- Each compatibility capsule has a named exit condition.
- The plugin neither depends on nor modifies instruction files.
