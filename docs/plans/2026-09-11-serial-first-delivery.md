# Relay: lean serial-first successor

Status: **Approved for targeted amendments and the bounded source implementation**.
Following both Pro reviews, the user approved proceeding with the amendments and
connected slice. The [amended contract](2026-09-12-relay-design-assessment.md)
incorporates the [review synthesis](2026-09-12-relay-design-review-synthesis.md).
Native acceptance, installation and pilot remain later gates. This is the single successor plan,
replacing the earlier Flow-adaptation proposal at this path. Completed native
probe evidence remains valid within its recorded limits.

## Outcome

Make ordinary sequential development inexpensive to start and dependable to
finish: one retained checkout, one current source writer, optional cheaper
sequential executors, verified results, reliable reporting, task-only archival,
and useful next-assignment admission.

**Relay is a lifecycle and agent-interface redesign with selective reuse, not
Flow with shorter skills or a compatibility wrapper.** Success means fewer
necessary concepts and operations, not feature parity or a LOC target.
Codex Orchestration is the umbrella project; Flow and Relay are plugins
([ADR 0074](../adr/0074-relay-successor-identity.md)).

## Evidence and uncertainty

- The [native same-checkout probe](../field-tests/2026-09-11-serial-native-feasibility.md)
  passed coordinator/executor/successor behavior and retained-source archival.
  Do not repeat it without a relevant host change. It does not prove Relay's
  ownership, reporting, recovery, or installed coexistence.
- The [consultation synthesis](2026-09-12-serial-architecture-consultation-synthesis.md)
  identifies reporting extraction as the unresolved dependency boundary.
  Existing reporting imports lifecycle owners and recursively stages `lib`;
  copying a few entrypoints does not prove a small independent package.
- [Observed startup overhead](../field-tests/2026-09-12-coordinator-startup-overhead.md)
  includes repeated reads, implementation/schema searches and a handwritten
  153-line activation request before registration. The user's >100K context
  estimate is unverified; the interface failure does not depend on that number.
- Plotloom's no-work settlement succeeded, but an older completed/cancelled
  assignment with a retained checkout still blocked the newer reader. Test
  combined historical journeys, not only isolated repairs.
- The parked repair suite passed 254/254 in 430.021 seconds. That is a particular
  candidate measurement, not a universal Flow baseline. Relay must not inherit
  or duplicate the entire legacy suite.

## Scope and non-goals

Include coordinator-only delivery and coordinator → sequential executor →
coordinator verification in the same retained checkout. Serial does not mean
solo. Read-only review may overlap against stable committed evidence or a
reserved verification checkpoint; a named commit does not freeze working-tree reads.

No concurrent writers, isolated-worktree mode, mixed execution modes, cross-host
support, live journal migration, or same-repository simultaneous Flow/Relay
control. No dashboard, daemon, general workflow framework, feature-parity program,
or automated broad reset.

Flow stays frozen for existing obligations, with narrowly justified protection
fixes only. Park local 0.9.14-rc.1; it is not a prerequisite release. Defer expanded
preserve-and-reset work and Flow's naming cleanup until Relay is stable and usable.
Do not advertise rarely exercised legacy features as a proven advanced fallback.

## Approved repository layout

Create Relay directly in `plugins/relay`, with its own package/plugin manifests,
README, changelog, runtime, skills, tests and product documentation. Keep Flow's
existing root package and files in place during Relay development. Root `docs/`
holds umbrella decisions and cross-plugin plans; do not move historical Flow
documents merely to make the tree symmetrical.

After Relay is stable and usable, move Flow to `plugins/flow` together with the
separately scoped legacy naming cleanup. The eventual root README introduces both
plugins, and each plugin owns its build, validation, packaging and versioning.
That later migration must verify path, release-tooling and installation
compatibility before changing legacy sources. No shared runtime library,
synchronized releases or new workspace framework is required by this layout.
See [ADR 0074](../adr/0074-relay-successor-identity.md).

## Consequential constraints

1. **Minimum authoritative facts.** Design from the journey before choosing modules.
   Do not reproduce overlapping assignment/run/iteration/cleanup completion states
   merely because Flow has them. Keep independently necessary distinctions:
   writer release, result acceptance and final-report delivery are different facts.
2. **One current writer, including verification.** Every start/resume/handoff checks
   current permission. Transfer an exact checkpoint to its intended next owner;
   avoid an unowned verification gap. Replays reconcile, never resurrect stale
   ownership. This is cooperative enforcement, not filesystem sandboxing. Account
   for background writers and source drift. Directors must not edit the shared
   checkout, including plans, while another task owns it.
3. **Retain source; retire tasks.** Use the existing checkout and explicitly selected
   branch, including `main`. No mandatory branch switch, worktree, synthetic merge,
   preservation transfer or Git reclamation. Archive exact eligible tasks without
   deleting source. Historical results remain valid after successor commits.
4. **Direct-result verification.** Share the necessary identity, baseline, committed
   scope and test checks between local and delegated work, preserving authorship.
   Check intermediate disallowed commits even if reverted. Bind verification to
   the exact tested revision; checks that change clean HEAD cannot certify the new
   revision. No fabricated executor integration or coordinator attribution.
5. **Honest failure retirement.** Failed/interrupted work can be safely retired
   without acceptance or satisfying dependencies. Preserve dirty/rejected work,
   establish quiescence and explicitly reconcile the next writer. No automatic
   rollback, stash, deletion or restart. Cancellation/archival alone is not source
   safety or permission to continue.
6. **Usable startup.** Prepared briefs provide exact public commands; code generates
   mechanical identities, bindings and request fields. Agents supply genuine work
   decisions, not rediscover schemas. Normal start/resume requires no implementation
   reads. Return compact actionable summaries; detailed diagnostics are opt-in.
   A short wrapper around the old lifecycle does not satisfy this requirement.
7. **Independent extraction and package.** Justify each reused primitive's semantic
   fit, transitive imports and packaged contents. Exclude Flow's lifecycle and
   compatibility engines; do not introduce a shared evolving framework for both
   products. Reuse needs relevant tests. Use independently packaged
   `plugins/relay` under the approved staged layout, without moving, renaming or
   repackaging legacy Flow during Relay development.
8. **Reporting is separate from source ownership.** Bind exact sender/recipient;
   preserve pending finals after writer release. Queue acceptance is not delivery.
   Late/duplicate/foreign-hook events cannot reauthorize work or redirect reports
   to successors. Reuse only transport/validation that stands independently of
   legacy launch, iteration and cleanup machinery.
9. **Adoption at safe boundaries.** Existing Flow work finishes or undergoes a
   separately authorized preservation-first cleanup before Relay adoption.
   Distinct plugin names/state directories do not prove mutual exclusion.
   No dual control of one repository. Same-App coexistence across separate
   repositories requires a native test before shared installation.
10. **Explicit transition and recovery rules.** The current control record is the
    single ownership commit point. Persist supporting result/report facts first;
    transfer executor ownership directly to exact coordinator verification.
    Distinguish never-write-enabled revocation from possibly-active-writer recovery.
    Do not transplant Flow's automatic stale-lock reclamation. A recovered command
    lock is not evidence that a source writer is quiescent.

## Checkpoints

### 1. Bounded extraction assessment and minimal contract

Produce one concise source-backed decision record: required responsibilities,
minimal facts/transitions, components to reuse/rewrite/remove, transitive package
boundary, public startup interface and unresolved host assumptions. Use the existing
adaptation map as comparison, not a second implementation plan. Ask what Relay
needs, not how to retain everything Flow does.

Walk cold start from the proposed brief. Distinguish code-generated values,
agent choices and host observations. Agree a measurable budget for plugin-added
startup context, calls and elapsed time before implementation; separate product
reading and ambient App context. Zero internal-source reads on successful startup
is already a firm acceptance requirement.

After that concrete draft, request two complementary Pro reviews:

- **Lifecycle/recovery:** challenge unnecessary states and owners; check interrupted
  transfers, honest failure retirement, reporting and useful successor safety.
- **Agent interface/lightness:** walk startup and ordinary failure using the public
  surface alone; challenge schema reconstruction, context/call cost and hidden
  legacy package dependencies. Do not request feature parity.

Use one self-contained copy/paste prompt per reviewer, GitHub-only access and no
assumed memory. Publish the approved source/evidence packet before calling prompts
ready; this draft authorizes neither pushing nor browser/account operation.
The user subsequently authorized publishing the assessment packet on a review
branch and preparing the two prompts. Preserve returned reports and distinguish
hypotheses from verified source facts.
No further broad audit or duplicated consensus exercise.

At the gate, approve the minimum contract/build scope, revise a specific disputed
boundary, or stop. If extraction reproduces Flow, reconsider the design before
implementation rather than build generic infrastructure to rescue it.

Checkpoint 1 is complete. The two reviews support the direction with targeted
amendments, now incorporated in the assessment. Do not repeat a broad audit.
The next deliverable is the connected source implementation below.

### 2. One connected source implementation

Implement local work → sequential executor → verification → final reporting →
acceptance → task-only archival → useful successor. Coordinator-only delivery
uses the same semantics. Build a useful vertical slice early, not several
foundation releases before exercising delivery.

Add one honest failure/interruption journey and targeted adversarial boundary
tests. After one supporting-instrument checkpoint, attempt the connected outcome
next or replan; further instrumentation needs a demonstrated unmet causal question.
Do not use the unfinished successor to control its own initial development.

### 3. Native proof and controlled pilot

In a disposable repository run the connected solo and delegated journeys with
real tasks, real idle-final delivery and task archival, then a useful successor.
Exercise bounded failure recovery. Source and refs must survive; old history must
not require recreating, freezing or deleting the retained checkout.

Keep the outer delivery process stable and candidate staged separately. Test
foreign-hook harmlessness and pending old reporting before shared installation.
Coordinate any install/restart with active projects. After acceptance, authorize
one real-project pilot at a completed-work boundary; broader rollout follows a
complete pilot round, not just startup success. Release one useful validated
package, without unnecessary intermediate publishing.

## Acceptance evidence

Track known failure families in the umbrella [issue checklist](../known-issues.md).
Update each plugin's status with verified closure evidence; plan coverage alone
does not close an issue, and Relay fixes do not imply legacy Flow fixes.

- A fresh coordinator starts from the brief/public interface without internal
  code searches or handwritten protocol boilerplate. Measure context, calls and
  elapsed time against checkpoint-1 budgets. Disclose manual recovery; do not
  label a repaired canary uninterrupted success.
- Solo and sequential-executor journeys use no extra worktrees/branches,
  synthetic integrations or deletion of retained source.
- Competing writers, stale resumes, interrupted transfers and source-mutating
  checks cannot silently grant permission or produce accepted results.
- Combined history containing completed/cancelled assignments and an interrupted
  unstarted assignment permits legitimate successor work after explicit recovery,
  without rewriting outcomes or erasing unrelated history. Pending ownership or
  reporting blocks precisely the operations it governs.
- Real reports reach the correct owner; acceptance and eligible task archival
  complete. Observe ambiguous host results without replay. Synthetic hook calls
  are not genuine idle-final evidence.
- Package inspection proves the dependency cut; small entrypoint size does not
  conceal all-of-`lib` staging or legacy runtime imports.
- Cheap pure checks cover pure rules; a small set of real-Git/CLI journeys covers
  boundaries that need them. Report timings and duplicate coverage removed.
  Run affected tests during development and one proportionate final combined suite;
  rerun for changed risk or missing results, not every metadata/docs adjustment.
- Source tests, native coexistence and live pilot evidence remain distinct.

## Execution authority and escalation

Current authorization: amended design and checkpoint 2 source implementation,
including an independently packaged `plugins/relay` and focused local tests.
No installation, migration, Plotloom changes or cleanup is authorized. Prior
publication permission covered the review packet; it does not authorize a release
or merge to main. Keep the parked Flow repair source and installed package unchanged.
The completed probe and incident-specific exception do not authorize the build.

Delivery selection for checkpoint 2: the user explicitly requested the dedicated
Relay implementation task. Use a source-only Codex task in its own development
worktree, with direct reporting to this director; do not activate Flow/Relay runs
to control the build or claim authenticated hook delivery. This isolates initial
development, not Relay's eventual serial user workflow. The task reads the approved
documents from the director checkout, owns `plugins/relay`, and returns its source
result and actual verification. Native canary tasks and installed hook behavior
remain outside this source-only assignment.

The director owns intent, synthesis and acceptance. Delegate the approved bounded
assessment, then after the design gate appoint one delivery owner for the approved connected
build. Use explicit selectors and cheaper workers for bounded work when useful;
do not default to solo or maximal staffing. Collect native subagent results before
returning idle. A live canary coordinator has explicit director ownership.

Flow's plan skill documents intent, not Relay's runtime architecture. Before
dispatch, explicitly choose an established delivery path or authorize source-only
native delegation. Do not force self-development through blocked legacy state.

Escalate for additional lifecycle engines, unavoidable legacy dependencies,
unproven source/report safety, broader compatibility, host behavior that threatens
retained source, changes to active projects or material scope growth. Keep the
legacy plugin lane frozen rather than repair it opportunistically during Relay.
