# Codex Orchestration

This umbrella repository contains two independently versioned plugins:

- **[Relay](plugins/relay/README.md)** — the serial-first path: one retained checkout,
  optional sequential executors, verified results, report receipt and task archival.
  Start with Relay's [same-host quick start](plugins/relay/README.md#same-host-quick-start).
- **Flow** — the existing root package, still installed and invoked as
  `codex-orchestration`. Existing Flow projects keep their current workflow.
  Its folder/name migration is deferred; do not run both plugins against the same
  repository's source ownership.

Relay releases use `relay/vVERSION` tags and their own package checks. Existing
`vVERSION` tags and the instructions below belong to Flow. Neither package is
published to npm.

## Existing Flow plugin

For the maintainer's projects moving to Relay, use the
[approved lean adoption procedure](docs/adr/0075-personal-flow-to-relay-adoption.md).
It replaces historical Flow repair with scoped operator disposal after minimal
source/writer checks; it does not migrate or delete product work.

Codex Orchestration is a repository-governance plugin for coordinating several
independent, user-visible Codex tasks as one accountable workflow. Codex App
still creates and runs tasks; this package binds their intent, dependencies,
ownership, identity, Git effects, quiet results, integration, and cleanup.

Accepted releases are immutable annotated tags. The source is MIT licensed;
`package.json` remains private because npm is not a supported distribution
channel.

## Install and first use

Codex Orchestration currently ships through its maintainer's personal Codex
plugin marketplace, not npm or a public marketplace. With that marketplace
configured, install the exact release in the Codex plugin browser or run:

```text
codex plugin add codex-orchestration@personal
```

Then restart the ChatGPT desktop app or start a new Codex CLI session so the
new plugin catalog and hooks load. This matches the [official OpenAI plugin
guidance](https://learn.chatgpt.com/docs/plugins), which says installed plugin
capabilities become available to new chats and CLI users should start a new
session. Do not copy skills or edit installed cache files by hand.

Start with a natural-language request such as “Use Codex Flow to direct this
outcome” or “Deliver this bounded assignment with Codex Flow.” The plugin will
route to the appropriate director, coordinator, integration, refresh, or
cleanup workflow. Existing runs keep their immutable runtime snapshot after an
upgrade; finish them there or use the authenticated refresh workflow.

Native queued reporting is supported only between tasks on the same local host.
For another host, relay the final result manually and preserve its source task
identity; cross-host automatic delivery is not claimed.

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

Equivalent reconciliation replays compare the creation and selector facts,
retain their original timestamps, and preserve the original creation shape.
Iteration membership references the persisted launch rather than hashing a
changing launch view, so authenticated start can advance one provisional or
opaque projection without rekeying cleanup history. A completed exact start may
finish bookkeeping after legitimate branch work without rerunning activation.

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

State lives under the exact package namespace,
`.git/codex-flow/v<package-version>/`, and is not tracked in the repository. A
run never hot-switches its runtime.

The package requires no tracked setup and never reads, writes, validates, or
depends on repository or global instruction files.

## Native surfaces and selector policy

Choose the execution surface first:

| Surface | Intended use |
| --- | --- |
| Coordinator task | Sequential decisions or shared evolving state |
| Native subagent | Bounded read-only supporting work |
| Visible task | Independent mutating work needing durable Git lifecycle |

The director owns goals, strategic conversation, tradeoffs, and acceptance.
The coordinator owns bounded delivery, delegation, integration, and
verification; executors own scoped implementation and evidence. A director may
also perform bounded direct work, and no fixed task count is required.

The current explicit recommendation is:

| Work | Recommendation |
| --- | --- |
| Substantive, well-scoped executor work | Luna, xhigh |
| Bounded nontrivial implementation or review | Terra, high |
| Difficult root-cause analysis or integration | Terra, xhigh |
| Settled routine delivery with established checks | Terra, high |
| Bounded demanding implementation or diagnosis | Terra, xhigh |
| Unsettled architecture, interacting authority, or difficult integration decisions | Sol, high |
| Optional consequential director judgment | Astra, high |

Luna-xhigh is a user-selected preference, not an empirical optimum. Trivial
work may use a lower-effort override with a stated rationale. Higher Sol effort
requires an explicit need. Ultra is forbidden for native subagents and
exceptional for visible tasks. Every native call passes selectors and
rationales explicitly. There is no inherited selector, availability probe,
automatic fallback, model registry, or silent escalation. A deliberate
override replaces the rationale. Delivery owners choose by the hardest expected
judgment in the assignment, independent of their title or whether they use a
child task.

## Quiet completion and urgent interruption

Routine executor completion is a durable quiet callback. The task's final text
and native wait state are liveness only. The coordinator selects a terminal
receipt v4 at a safe boundary and authenticates it against `launch_id`, task
contract, selector evidence, and Git outcome before disposition.

Coordinator-to-director completion uses an authenticated sender/recipient report
route. A sender-scoped locator lets the installed Stop hook submit the exact
final text to the native queue without interrupting an ordinary-busy director;
queue acceptance proves transport submission, and the director receives the
report on a separate safe turn. Route closure retires the locator. Missing or
ambiguous authority fails closed and uses the explicit recovery or manual
blocker path instead of replaying a report blindly.

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

### Retained-obligation recovery

When `assignment accept` reports `execution-obligations-retained`, inspect its
`settlement_blocker` and run `cleanup plan --run-id RUN --json` through that
run's immutable runtime. Complete the named ordinary archive, integration,
preservation, or branch cleanup action, then repeat the same `assignment accept`
request. A successful retry continues owning-host coordinator closeout and can
itself be repeated after interruption. Never edit the abandoned terminal object,
its retained retirement, or old runtime files.

Overlapping admission remains blocked across v0.9 runtime namespaces until this
derived proof is complete. An authenticated refresh is the sole exception: it
may exclude its exact source-retired namespace while consuming the persisted
handoff, without weakening checks for any unrelated predecessor.

When coordinator completion or run audit reports `committed-write-scope`, review
the named commit/path against both the task write set and admitted run envelope.
Preserve the evidence, correct the planning or integration authority before a
new operation, and re-execute through normal workflow commands. A revert does
not erase the earlier committed violation, and safe retirement does not turn a
noncompliant execution into a compliant one.

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
relabelled as a legacy creation operation: refresh retains the exact launch ID,
archives and retires its exact task/worktree/branch authority, and records that
cleanup in any owning assignment iteration before source deletion. The target
never parses or migrates source journals. Unsupported older state uses the
explicit unplug path.

Current v0.9 sources also expose coordinator-owned workflow claims. Refresh
reissues an unfinished coordinator claim with fresh task and selector identity,
without inventing child archive, worktree, or branch cleanup. A completed
coordinator claim remains in the authenticated baseline; only a genuinely
work-free source uses the no-replacement clean-start path.

## Command surface

Run `codex-flow --help` for the exact inventory. Principal families are:

```text
run activate|status|resume|rebind|audit|close|abandon
workflow create|revise|status|contract
workflow local start|complete|status
task launch prepare|attempt|reconcile|start|status
assignment brief|status|closeout|accept
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

Every run-scoped stateful operation names `run_id`. Assignment operations use
their assignment ID because reporting and acceptance can outlive a run. Complex operations consume
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

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Mission and product boundary](docs/mission.md)
- [v0.9 architecture](docs/architecture-v0.9.md)
- [Finite compatibility capsules](docs/compatibility-capsules-v0.9.md)
- [Lessons carried from v0.5–v0.8](docs/lessons-learned-v0.8.md)
- [v0.9 coverage](docs/coverage-v0.9.md)
- [ADR 0043: native-first modular architecture](docs/adr/0043-native-first-modular-architecture.md)
- [ADR 0052: MIT source license](docs/adr/0052-mit-source-license.md)
- [ADR 0053: consolidated release candidates](docs/adr/0053-consolidated-release-candidates.md)
- [ADR 0066: lifecycle transition authority and replay](docs/adr/0066-lifecycle-transition-authority-and-replay.md)

Historical tags and ADRs remain evidence. Historical executable compatibility
is not part of the current package unless listed in the finite compatibility
register.
