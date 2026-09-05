# Codex Orchestration

Codex Orchestration is a repository-governance plugin for coordinating several
independent, user-visible Codex tasks as one accountable workflow. Codex App
still creates and runs tasks; this package binds their intent, dependencies,
ownership, identity, Git effects, quiet results, integration, and cleanup.

The current release candidate is `v0.9.1-rc.2`. Accepted public authority
remains immutable `v0.9.0` until the v0.9.1 maintenance gates pass. The package
is private and `UNLICENSED`.

## v0.9 architecture

```text
Replaceable routing policy
          |
Stable governance core
          ^ typed host evidence
          |
Codex App adapter
```

- **Stable governance core** owns workflow, launch, identity joins, ownership,
  immutable runtime state, callbacks, integration, verification, and cleanup.
- **Replaceable routing policy** recommends a surface, model, reasoning effort,
  and rationale. Its recommendations become explicit contract fields; it does
  not run a lifecycle or inspect App state.
- **Codex App adapter** translates native task-creation results, executor
  identity claims, selector observations, provisional mapping, and archive
  observations into versioned typed evidence.
- **Compatibility capsules** are finite, named bridges around a specific host
  gap or immediately preceding release boundary. They never become general
  predecessor readers.

The machine-readable module-layer registry is
[`lib/module-layers.json`](lib/module-layers.json). Validation enforces its
complete inventory and import direction. Governance code contains no App
session vocabulary, cache paths, event names, or current model names.

## Native-first visible-task launch

The first executor prompt is useful. It contains the full generated contract,
launch ID, nonce, and exact `task launch start` command:

```text
task launch prepare
        |
task launch attempt
        |
one Codex App task creation call with the full assignment
        |
creation result reconciliation <-> exact executor start claim
        |
task launch start: authenticate + attach reserved branch
        |
useful work in that same first turn
```

`task launch start` reads the host-exposed task identity, authenticates the
run-bound runtime, operation, contract, and nonce, verifies the linked
worktree's Git common directory and pristine baseline, rejects the coordinator
checkout, records branch-binding intent, attaches the reserved executor branch,
and revalidates everything before source mutation.

The executor claim can establish the real ready ID independently of whatever
shape task creation returned. A known host ID must agree. A provisional ID or
unknown future result is retained as bounded evidence but never authorizes a
retry. Project, title, timing, and worktree path can narrow discovery but never
establish identity.

There is no bootstrap-only executor turn, coordinator-side branch-binding wait,
second objective prompt, ordinary release message, or normal-path private
history scan.

## Workflow authority

Every actionable run records:

- one immutable runtime snapshot in the Git common directory;
- one content-addressed workflow revision and generated task contracts;
- an acyclic dependency graph and bounded path/resource reservations;
- the primary outcome, nullable causal question, cheapest safe direct attempt,
  and instrumentation role for each task;
- explicit native surface, model, reasoning effort, selector rationale, and
  bounded fork history where applicable;
- one-shot native operations and requested, accepted, observed, unavailable,
  or contradictory host evidence; and
- terminal receipt, disposition, integration/no-change, verification, archive,
  cleanup, and terminal audit records.

State lives under the exact package namespace, currently
`.git/codex-flow/v0.9.1-rc.2/`, and is not tracked in the repository. A run
never hot-switches its runtime.

The package requires no tracked setup and never reads, writes, validates, or
depends on repository or global instruction files.

## Native surfaces and selector policy

Choose the execution surface first:

| Surface | Intended use |
| --- | --- |
| Coordinator task | Sequential decisions or shared evolving state |
| Native subagent | Bounded read-only supporting work |
| Visible task | Independent mutating work needing durable Git lifecycle |

The initial least-capable-sufficient recommendation is:

| Work | Recommendation |
| --- | --- |
| Mechanical, local, or clear read-only work | Luna, medium |
| Bounded nontrivial implementation or review | Terra, high |
| Multi-module diagnosis or integration | Terra, xhigh |
| Coordination or systemic decisions | Sol, high |

Higher Sol effort requires a stated need. Ultra is forbidden for native
subagents and exceptional for visible tasks. Every native call passes selectors
explicitly. There is no inherited selector, availability probe, automatic
fallback, model registry, or silent escalation. A deliberate override replaces
the rationale.

## Quiet completion and urgent interruption

Routine completion is a durable quiet callback. The task's final text and
native wait state are liveness only. The coordinator selects a terminal receipt
v4 at a safe boundary and authenticates it against `launch_id`, task contract,
selector evidence, and Git outcome before disposition.

Urgent blockers, approval needs, ownership collisions, and high-risk drift use
a separate persisted one-shot interrupt. An ambiguous delivery cannot be
retried blindly. This separation prevents routine task completion from Steering
and disrupting a working coordinator.

## Integration and cleanup

The coordinator integrates accepted commits serially, proves explicit
no-change outcomes, runs combined verification, finalizes the disposition once,
and archives the exact task. Public archive visibility and host worktree
reclamation are separate observations.

Ordinary cleanup is read-only: `cleanup plan --run-id ...` re-derives exact
eligibility and returns required host/Git actions. Unplug is a distinct,
approval-gated repository clean-start lifecycle. It inventories exact state,
archives known tasks first, removes eligible worktrees before local branches,
deletes state last, and never mutates remote refs or source history.

## Long-lived coordinator refresh

A refreshed coordinator inspects authority once:

- `fresh`: activate a new v0.9 run;
- `resume-source`: continue the old run through its immutable snapshot;
- `refresh-ready`: prepare one bounded wait/discard handoff;
- `blocked`: resolve the named authority or evidence ambiguity.

v0.9 accepts an authenticated v0.8 semantic refresh export. Maintenance
targets may also retire a cleanup-complete terminal v0.9 source through an
authenticated no-replacement refresh. Cleanup transfer grammar is selected by
the exact source package: v0.8 retains operation identity, while v0.9 retains
launch identity. Exact v0.8 executor-local work may be archived and discarded,
then only its semantic assignment is reissued with fresh task, launch, branch,
worktree, selector, and rationale identities. Launch-based v0.9 discard is not
relabelled as a legacy creation operation and fails closed. The target never
parses or migrates source journals. Unsupported older state uses the explicit
unplug path.

## Command surface

Run `codex-flow --help` for the exact inventory. Principal families are:

```text
run activate|status|resume|rebind|audit|close|abandon
workflow create|revise|status|contract
task launch prepare|attempt|reconcile|start|status
subagent prepare|attempt|reconcile|complete|dispose|status
callback deliver|observe|status
urgent persist|attempt|reconcile|observe|consume|expire|status
disposition prepare|finalize|status
integration prepare|verification-request|reconcile|status
verification run|status
archive prepare|reconcile|observe-private|status
cleanup plan
refresh inspect|prepare|observe-private|apply|status
unplug plan|observe-private|apply
```

Every run-scoped stateful operation names `run_id`. Complex operations consume
a closed JSON request from `--file`. Native App calls remain external; the CLI
emits exact host requests only when persisted state authorizes them.

## Development and verification

Requires Node.js 20.11 or newer and has no third-party runtime dependencies.

```bash
npm test
npm run validate
npm run pack:check
git diff --check
```

Validation checks schema/runtime parity, package identity, complete module-layer
classification, allowed import direction, retired executable absence, current
skill and template contracts, and package contents. Stable promotion also
requires an annotated exact tag, artifact/cache equality, and the live
same-coordinator App canary described in
[`docs/coverage-v0.9.md`](docs/coverage-v0.9.md).

## Maintainer references

- [Mission and product boundary](docs/mission.md)
- [v0.9 architecture](docs/architecture-v0.9.md)
- [Finite compatibility capsules](docs/compatibility-capsules-v0.9.md)
- [Lessons carried from v0.5–v0.8](docs/lessons-learned-v0.8.md)
- [v0.9 coverage](docs/coverage-v0.9.md)
- [ADR 0043: native-first modular architecture](docs/adr/0043-native-first-modular-architecture.md)

Historical tags and ADRs remain evidence. Historical executable compatibility
is not part of the current package unless listed in the finite compatibility
register.
