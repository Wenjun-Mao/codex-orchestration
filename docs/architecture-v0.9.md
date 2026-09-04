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

## Stable Flow governance core

The core owns only host-independent workflow semantics:

- run/runtime authority and repository reservation fences;
- content-addressed workflow revisions and generated task contracts;
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
