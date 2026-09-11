# Retained-obligation settlement: external review context

Purpose: challenge the diagnosis and draft design before implementation, not
certify a release. Companion plan:
`docs/plans/2026-09-11-retained-obligation-settlement.md` (Draft).

## Product and operational context

Flow is a Codex plugin for a mostly solo developer. A long-lived director stays
available for strategy, short-lived coordinators deliver assignments, and
optional executors do bounded work. The coordinator closes child lifecycles;
the director reviews delivery, accepts it, and performs coordinator host archival
and reconciliation. Reporting hooks transport results but do not replace
receipts, acceptance, or resource authorization.

The user values safety AND low ceremony. Prior releases repeatedly exposed gaps
between individually checked stages: preservation, closeout, upgrades and next
admission. v0.9.12 improved settled historical admission and is now used in an
ordinary product project. This incident is not plugin self-development and is
not an old-version migration. Avoid dismissing it as either. Conversely, it
does not show that ordinary successful closed-run cleanup is universally broken.

## Pilot observation, with provenance boundaries

The pilot delivered Codex Usage 2.6.0. Below are bounded observations, not a
public copy of its repository, full journals, source code, or chat history.

Direct read-only `assignment status` inspection by the plugin director found:

- assignment state `accepted`, with a persisted acceptance;
- execution `usage-v260-3832` in namespace `v0.9.12` terminal as `abandoned`;
- execution retirement `resource_disposition: retained`;
- iteration `closeout-pending`; three executors `archived`, coordinator
  `registered`;
- recorded abandonment reason: immutable path fences omitted two production
  wiring files. Launched executor work had been integrated/verified and cleaned
  before abandonment; remaining product work was to be replanned.

The project director subsequently reported, after bounded read-only inspection:

- product delivery completed and was accepted;
- `cleanup plan` has zero candidates/blockers, no active runs, all three bound
  executor branches/worktrees resolved, and an unused release branch fence resolved;
- coordinator closeout is phase-complete but director acceptance remains blocked
  by the retained retirement;
- unplug would remove Flow state but inventory no coordinator Git resources, so
  it would leave the coordinator worktree/branch. It was not applied.

The second list is a reported diagnostic, not independently reproduced raw
evidence in this public packet. In particular, it does NOT prove that all
logical path/resource obligations have been settled. The coordinator remains
preserved. No proposed repair has been applied or demonstrated.

The publicly available evidence supports source inspection and test design.
It cannot certify pilot preservation, host archival, runtime identity, or live
recovery. Request specific additional sanitized facts if those change a design
decision; do not infer inaccessible journal contents.

## Source map and initial findings to verify

- `lib/assignment-acceptance.mjs`: `reconcileTerminalExecutionEvidence` skips
  existing retirements; `acceptAssignmentResult` returns
  `execution-obligations-retained` before coordinator closeout; cancellation
  preserves coordinator/Git ownership.
- `lib/assignment-authority.mjs`: `executionRetirement` requires `released`
  to have terminal status `closed`; `recordAssignmentExecutionRetirement`
  permits a refresh retirement update, not ordinary cleanup settlement.
- `lib/run-lifecycle.mjs`: abandonment preserves the original fence plan.
- `lib/compat/refresh-source.mjs`: inspect both `terminalFencesRemain` and
  historical settlement validation, not just physical cleanup eligibility.
- `lib/iteration-registry.mjs`: inspect ownership checks, cancellation reuse,
  coordinator archive/reclamation, and successor constraints.
- `bin/codex-flow.mjs`, related schemas and `skills/direct/SKILL.md`: determine
  what callers can actually do through public commands and which role owns it.
- `test/assignment-lifecycle-v097.test.mjs`: accepted-then-cancelled retained
  obligation tests and successor tests; `test/refresh-v09.test.mjs` and
  `test/cli-v09.test.mjs`: historical admission and connected CLI scenarios.

Working hypothesis: failure outcome and resource settlement need distinct
semantics. This is not a requirement to invent a new journal or service. First
look for an overlooked complete existing path. Never equate missing worktrees,
an accepted product report, or zero cleanup candidates with release of all
ownership. Identify what each fence actually reserves and who may discharge it.

## Review mandates

If two reviewers are used, give them complementary emphases, independently:

1. Diagnosis and minimal architecture: falsify the claimed missing transition;
   compare existing mechanisms with the smallest safe correction. Identify the
   proper owner of settlement and state that should NOT be added.
2. Adversarial evidence and stage connections: try to invalidate settlement via
   incomplete obligations, stale evidence, concurrent owners, crash/replay,
   preserved-result loss, and next admission after legitimate reclamation.

Both should inspect source at the supplied exact commit, distinguish observed
facts from inference, and return an answer-first judgment with source citations,
necessary plan amendments, unresolved questions, and the smallest decisive tests.
No vote-based acceptance or mandatory broad audit. Proposals remain review input.

## Boundaries

No implementation yet; published v0.9.12 remains immutable. No new daemon,
dashboard, routing policy, wholesale state migration, or automatic pilot cleanup.
Plotloom's separate v0.9.8 wrong-runtime-root incident is out of scope. Broad
permission to settle any abandoned run is not intended. If a narrow correction
cannot safely recover persisted v0.9.12 state, explain the precise missing proof
instead of recommending a permissive bypass.

## Post-implementation RC1 live-gate observation

The installed RC1 gate later produced a distinct operational failure after the
retained producer had settled successfully. A detached, coordinator-only
successor was activated with an operator-authored `main` branch fence despite
having no executor launch. The useful write and coordinator committed-scope
checks passed; cleanup and the run audit then refused normal closure because the
unbound fence named the live branch attached to the primary checkout.

The causal input error and product behavior must remain separate. The operator
should have supplied an empty branch fence array. Downstream cleanup was safely
conservative and no branch was changed. The admission layer nevertheless lacks
a detached-primary prevention guard: comparing a proposed fence only with the
coordinator's literal recorded branch cannot identify a protected primary branch
when that coordinator is detached. This is a future guardrail correction, not
evidence against retained settlement or committed-write-scope enforcement, and
it does not authorize repairing immutable run state.

For RC1 release evidence, the user approved one fresh isolated supplementary
coordinator run with the same useful write and explicit `branch_fences: []`.
That run may prove ordinary completion, audit, close, reporting and cleanup. It
does not reproduce the earlier settled-predecessor admission, so final reporting
must preserve the split-evidence boundary rather than claim one continuous
journey.
