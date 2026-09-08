# v0.9 native-first modular architecture

## Decision shape

```text
Replaceable routing policy
          |
Stable Flow governance core
          ^ versioned typed host evidence
          |
Codex App adapter

Compatibility capsule -> adapter/core public contracts only
```

This separation lets App integration and model recommendations evolve without
changing the durable meaning of a run. The complete module classification and
allowed import direction are machine-enforced by
[`lib/module-layers.json`](../lib/module-layers.json).

The `lib/` root and `lib/core/` contain governance; `lib/policy/`,
`lib/adapters/codex-app/`, and `lib/compat/` are the three physically isolated
change boundaries. Validation rejects a module whose declared layer disagrees
with that location.

## Director plan and coordinator handoff

The v0.9.3 planning contract adds a durable boundary above the execution DAG:

```text
director + user settle intent
          |
          v
saved approved plan path
          |
          v
tool-derived immutable snapshot + one full coordinator assignment
          |
          v
coordinator adds technical detail, delivers, integrates, and verifies
```

There is one approved project plan, not separate director, coordinator, and
executor plans. Assignment preparation accepts its path, derives the content
identity, and saves an immutable readable snapshot before dispatch. The source
may be uncommitted; later source edits do not alter the assignment. Registration
validates the saved snapshot automatically, while models neither compute nor
manually authenticate plan hashes or commits.
The director owns outcome, scope, non-goals, tradeoffs, acceptance, delegated
authority, and escalation. The coordinator owns technical breakdown,
dependency ordering, executor selection, integration, verification, and
authorized release work. Material changes to intent, acceptance, risk, scope,
or external authority require a new approved revision.

The skill-level `plan` contract may persist a planning document in ordinary
mode but does not implement product changes. Native Plan mode is optional. For
“Implement the plan”, the director persists/binds, dispatches one coordinator,
reports the bounded dispatch state once, and returns to strategic conversation;
it does not locally implement or enter a progress-monitoring loop. The
coordinator receives the real approved assignment in its initial prompt and
returns one complete result to exactly one named recipient/path. Result
transport is not acceptance.

## Stable Flow governance core

The core owns only host-independent workflow semantics:

- run/runtime authority and repository reservation fences;
- content-addressed workflow revisions and generated task contracts;
- exact approved-plan content and director-to-coordinator assignment boundary;
- DAG, dependency, ownership, and shared-resource admission;
- one-shot visible-task launch and native-subagent operations;
- the identity join between a contract, launch, executor claim, selector
  evidence, worktree evidence, and terminal result;
- quiet callbacks, urgent one-shot interrupts, disposition, integration,
  verification, archive eligibility, cleanup, and terminal audit.

Core code must not know App session paths, private event names, raw creation
result fields, plugin cache layout, or current model names. It accepts typed
evidence and rejects incomplete or contradictory authority.

## Codex App adapter

The adapter translates current host behavior into discriminated evidence:

- native creation result: ready, provisional, opaque, or contradictory;
- executor start identity claim;
- linked-worktree and selector evidence;
- bounded provisional-to-ready mapping evidence; and
- public or private archive observations.

Unknown future creation shapes become bounded opaque records. They do not
authorize retries. An executor's exact `task launch start` claim may establish
ready identity even when the creation return was provisional or opaque; a known
host identity must agree.

The adapter never determines workflow ownership, integration eligibility, or
cleanup authority. Private observation is read-only and isolated from the
normal launch path.

## Replaceable routing policy

Surface selection precedes model selection:

- coordinator for sequential or shared evolving state;
- native subagent for bounded read-only support;
- visible task for independent mutating work requiring durable Git lifecycle.

[`lib/policy/selector-policy.mjs`](../lib/policy/selector-policy.mjs) maps an
explicit work lane to a model, reasoning effort, and rationale. It has no App,
repository, network, task, or journal dependency. The generated contract stores
only the operational selectors and rationale, so replacing policy data creates
no second lifecycle state machine.

Policy recommendations are explicit and auditable, not automatic routing.
Overrides require a replacement rationale. Availability probing, silent
fallback, inheritance, learned routing, and dynamic worker counts remain out
of scope until held-out evidence supports them.

## Native-first first-turn launch

The App receives the full generated assignment as the task's first prompt. The
executor runs a deterministic start command before source access. That command
authenticates identity and authority, verifies the pristine linked worktree,
persists branch-binding intent, attaches the reserved branch, revalidates, and
then permits useful work in the same turn.

This moves branch activation to the only process that already has both the real
task identity and actual worktree. It removes the earlier bootstrap-only model
turn, coordinator bind wait, and second release message without weakening Git
ordering. Local start reconciliation is idempotent around pre-switch and
post-switch crashes; native creation remains one-shot.

In v0.9.3 the same start command also registers the exact active launch's
same-host executor-to-coordinator report route and writes a repository-local,
sender-keyed locator that pins the immutable reporter and native queue
configuration. A coordinator separately registers its director route from the
active run, current coordinator identity, tool-validated approved-plan snapshot,
and a pre-bound director generation. In v0.9.7 that registration creates an
assignment-lived authority and iteration record outside the removable run
namespace. The run remains execution evidence, but closing it does not retire
the coordinator route. Refresh appends the exact admitted replacement execution
to the same assignment before consuming the handoff or deleting source state;
historical bindings and their callback fences remain unchanged. The Stop
adapter resolves only that exact sender locator, delegates
capture/deduplication/lifecycle to governance core,
then makes at most one bounded queue submission. No global task scan or second
report state machine exists. Task disposition closes its executor launch route;
director acceptance closes the assignment route only after its selected report
and iteration closeout are resolved. Late events from retired assignments stay
fenced by their old route and source-turn identities.

Workflow tasks may also use `execution_kind: coordinator`. Their start binds
the real coordinator and Git baseline, and completion executes checks before
recording a mutation revision or no-change proof. The closure audit joins these
claims with ordinary child claims, so zero-child and mixed workflows use the
same accounting contract.

An assignment's iteration registry records members only from authenticated
assignment and launch commands. The assignment-derived executor title is the
exact title passed to the host and recorded by the registry. Closeout prepares
eligible children before the coordinator as one exact owning-host App action,
persists the attempt before returning it, and reconciles the owning role's
bounded result and exact private archive observation without replay. Executor
closeout completes the existing run-level archive operation rather than adding
an iteration-only substitute. For an
accepted member whose worktree remains, the same closeout revalidates exact
canonical path, exclusive membership, clean attachment and captured tip,
accepted result, and preservation in the authenticated primary baseline before
non-force Git removal. Patch-equivalent preservation is accepted only from the
same reconciled integration when its executor tip matches and the current
primary descends from its verified primary tip. After verified worktree absence,
it consumes the child's
callback/disposition/integration authority and deletes only the captured
matching tip of an
unattached `codex/` task branch for an eligible executor or disposable
coordinator. A coordinator must be an exact clean linked worktree, distinct
from the caller and primary checkout, whose tip is already contained by the
authenticated primary-checkout baseline. Source, caller, detached, unpreserved,
active, provisional, ambiguous, unclean, shared, conflicting, or drifted
members remain pending rather than being reported as closed. A coordinator the
user already archived is recovered only through exact private observation and
the same preserved-tip checks, without another native archive attempt.

The same first-prompt rule applies to the coordinator handoff: the coordinator
is dispatched with the complete approved assignment, a readable link to the
saved plan snapshot, constraints, acceptance checks, and one reporting route. A
coordinator is allowed to orchestrate; an executor contract cannot be relabeled
to grant that authority. A director may inspect progress when the user asks or
an actionable report warrants review, but normal dispatch ends its turn and
does not add a wait or polling scheduler.

Terminal receipt v4 binds to `launch_id`, not a separate release identity.
Downstream disposition, integration, verification, archive, cleanup, and audit
all authenticate that launch.

## Compatibility capsules

A Compatibility capsule has a named source gap, narrow evidence boundary,
fail-closed behavior, regression fixture, and explicit exit condition. It may
use adapter and core public contracts; core and policy never import it.

v0.9 retains exactly three capsules:

1. authenticated v0.8 semantic refresh export;
2. bounded read-only provisional-to-ready mapping for a task that never starts;
3. private archive observation while public archive indexing is insufficient.

Historical executable bridges remain available only through immutable tags.

## Import rule

| Importing layer | May import |
| --- | --- |
| Stable governance core | Stable governance core |
| Replaceable routing policy | Routing policy, governance core |
| Codex App adapter | Adapter, governance core |
| Compatibility capsule | Capsule, adapter, governance core |

Every packaged `lib/*.mjs` file must be classified exactly once. New modules
fail validation until their layer and legal dependencies are declared.
