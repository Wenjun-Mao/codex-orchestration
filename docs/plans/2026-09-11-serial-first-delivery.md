# Serial-first delivery

Status: Review amendments approved; native feasibility probe authorized. Runtime
implementation remains gated on the probe and explicit slice-inclusion decision.
Probe result: [native local-surface feasibility passed](../field-tests/2026-09-11-serial-native-feasibility.md).
This removes the immediate host feasibility blocker, not the Flow implementation
and connected acceptance requirements. Implementation has not been dispatched.
Priority: Before new preserve-and-reset implementation. Version assigned at release,
not used as an architectural constraint.

## Outcome

Make the user's normal, sequential development pattern the simplest supported
path: one retained checkout, one source writer at a time, inexpensive delegated
execution when useful, verified handoff, and finished-task archival without Git
reclamation. Separate worktrees become an explicit isolation/concurrency choice,
not a prerequisite for every coordinator and executor.

Success means removing unnecessary branch activation, integration, preservation-
transfer and worktree cleanup from serial delivery, not wrapping those same steps
in a new mode. Read-only review can still run concurrently.

## Diagnosis and evidence

The user estimates roughly 98% of their work is sequential. Current source assumes
more isolation than that normal case needs:

- `lib/core/task-launch.mjs` requires host-worktree execution, a distinct reserved
  executor branch, and a pristine linked checkout separate from coordinator and
  primary. Its activation and Git receipt paths enforce those assumptions.
- `lib/iteration-registry.mjs` registers coordinators as disposable and refuses
  primary-checkout reclamation. Director/coordinator skills do not explicitly
  require separate checkouts, creating a dispatch/closeout mismatch.
- Local coordinator work already has verified baseline/result and write-scope
  checks, but its record locks do not establish exclusive source ownership across
  a coordinator and its executors.
- Linked worktrees share the Git common directory and Flow state. They do not
  independently isolate lifecycle metadata or recovery.

These observations justify changing execution and resource ownership together.
They do not prove host support for shared-checkout tasks or enforceable exclusion
of arbitrary filesystem writers. Those boundaries must be tested explicitly.

## Scope and non-goals

Provide a coherent serial path through preparation, native task creation,
activation, execution, verification, report delivery, director acceptance, task
archival and subsequent assignment admission. Include coordinator-only delivery
and coordinator → serial executor → coordinator handoff in the same retained
checkout. Keep one coordinator per serial delivery scope.

Deliver two connected slices within this architectural plan: A is retained-primary
coordination, task-only archival and a useful successor (with existing isolated
delegation available); B adds shared-checkout executors. Probe both upfront.
Prefer delivering both together when feasible. A is independently shippable only
after an explicit scope decision, not silently relabelled as full serial delivery.
This division does not require intermediate public releases.

Reuse task identity, reporting, receipts, path checks and verification where their
semantics remain valid. Keep isolated execution available by explicit selection;
share common authority/verification logic rather than build two lifecycle engines.

Exclude live migration of running assignments, automatic reset, new dashboards,
daemons, broad test-framework rewrites, cross-host execution and arbitrary-agent
sandboxing. No pilot changes, native task creation, archival or release is
authorized by writing this plan. Preserve the published package and current runs.

## Consequential decisions

1. **Checkout and branch are separate choices.** Default to the existing retained
   primary checkout and its deliberately selected branch. If that is `main`,
   serial commits may remain on `main`; pushing/publishing remains separately
   authorized. An explicitly requested delivery branch in that same checkout
   is compatible. Never silently switch branches or create a worktree to satisfy
   an old disposable-resource assumption. Dirty entry state stops for preservation
   and reconciliation; no automatic stash, commit or deletion.
2. **One admitted writer, with honest enforcement boundaries.** Atomically grant
   source-write ownership to one exact task/claim for the serial repository scope,
   including across package namespaces sharing its Git common directory. Reject
   overlapping starts and stale handoffs. Reuse existing ownership primitives
   where sufficient; select the minimum durable representation in the ADR.
   A record lock or instruction alone is not a lifetime write permit. Flow must
   enforce admission and handoff, but cannot claim to block arbitrary shell edits,
   editors or already-running commands. Stop relevant background writers and
   detect source drift before accepting results. Directors must not edit the
   shared repository while another task owns it, including planning files.
   Reuse enclosing run/assignment admission and one current-writer reference,
   with an exact claim and transfer generation. Every write-enabling start/resume
   checks current permission: historical activation replay cannot resurrect it.
3. **Explicit serial handoff.** The coordinator releases source ownership only
   after a verified checkpoint; an executor acquires against that exact baseline.
   During executor ownership the coordinator may discuss, inspect stable evidence
   or wait, but not edit, switch Git state or run source-mutating commands. After
   the executor's durable result, transfer into an exclusive coordinator
   verification reservation, not a generally available gap. Atomically name the
   exact intended successor/checkpoint; retries reconcile that same transfer.
   Verification fixes the subject revision, branch and clean state before and
   after checks; checks must not change source. A later coordinator edit requires
   a new current claim. Receipt arrival or idleness alone is not a transfer.
   Background tool completion must be accounted for before release.
4. **Direct results, not synthetic integration.** A serial executor's accepted
   committed result is already in the retained checkout. Validate its identity,
   baseline, ancestry, write scope and tests without a branch merge, cherry-pick
   or invented integration record. Preserve no-change and failed/dirty outcomes
   truthfully. Shared verification should serve both local and delegated work,
   with execution provenance intact. Read-only checks that need stable source
   bytes use a named committed revision or wait for a checkpoint.
   A commit named in prose does not freeze reads from a moving working tree.
   Preserve per-commit scope checks, including changes later reverted. Introduce
   genuine direct-result disposition through dependencies, attribution, audit
   and closeout; never reattribute executor commits as coordinator work.
5. **Tasks are disposable; the checkout is not.** Record retained resource
   ownership explicitly. Archive eligible completed tasks and retire their routes
   without deleting the retained checkout or its branch. Do not infer resource
   disposal from role or task completion. Existing isolated tasks retain their
   exact cleanup rules. Real native archive behavior must support this distinction;
   if it cannot, stop and reconsider the surface rather than weakening preservation.
   Checkout retention is distinct from existing task-member `retained` and from
   unresolved execution obligations. Bind it into versioned prepared authority.
   Update eligibility, archive observation, run/iteration completion and historical
   successor readers together. Preserve each accepted result revision after later
   owners advance HEAD; history must not require the retained branch to disappear
   or remain forever frozen. Resolve required final reporting before route closure;
   source release does not retire the reporter or prevent its final delivery.
6. **Failure cannot silently transfer ownership.** Preserve partial edits and
   evidence. A crash, timeout, final message or archive does not automatically
   release a writer. Supported recovery must establish the old writer is inactive,
   reconcile its result or failed state, and revalidate the checkout before a new
   owner starts. Prefer the smallest explicit owner recovery over leases, timers
   or another recovery state machine. Do not force successful completion to move on.
   Unlike isolated work, a rejected direct commit already occupies the selected
   branch. Block dependents and ordinary continuation until explicitly authorized
   repair reconciles the source. Releasing failed ownership is not successful
   dependency acceptance; no automatic rollback, stash or preservation commit.
7. **Compatibility is bounded.** Existing assignments finish under their pinned
   contracts; do not reinterpret disposable resources as retained. New serial
   assignments explicitly declare retained ownership. Inventory existing active
   writers before admission so new authority cannot overlap old isolated work.
   Serial-to-isolated switching requires a settled checkpoint and explicit plan
   choice, not an executor silently switching surfaces mid-assignment.
   Test old/new admission in both orders, including closed execution with pending
   assignment and abandoned obligations. Older pinned code cannot be assumed to
   honor new permits; declare no coexistence where mutual exclusion is unproven.

## Checkpoints

### 1. Host feasibility and minimal contract

Use one disposable repository, native local tasks C/E and successor C2. Confirm
distinct actual task identities at the same canonical checkout, common directory
and selected branch. C commits a checkpoint, E makes a sequential follow-up, and
C remains usable after E is archived. Archive C and have C2 continue useful work.
Record refs, HEAD, worktree inventory and sentinel bytes around each archive;
make exactly one native call per intended creation/archive. Ambiguity stays pending.
No candidate installation or Flow activation is needed to test native behavior.
Native messages/observations prove only native feasibility, not authenticated
Flow route delivery or a successful Flow lifecycle.
If the native surface cannot support retained-checkout tasks, return the evidence
and options before implementing a runtime design around that assumption.

Produce one concise ADR mapping the existing stages to keep, remove or change.
Define the minimum writer ownership/handoff contract, retained resource semantics,
serial result disposition and compatibility boundary. Identify obsolete serial
branch/integration/cleanup obligations and their deletion points. Stop for review
if this requires a second workflow engine or cannot establish reliable admission.

### 2. One connected serial implementation

After a recorded probe/inclusion decision, implement slice A end to end and slice
B when included, without a succession of foundation releases. Full B: prepare → coordinator local work
→ executor handoff and result → coordinator verification → final reporting and
acceptance → task-only closeout → fresh serial assignment. Use the same core
checks for the coordinator-only path. Update generated briefs, schemas, skills
and CLI boundaries together; do not leave prose permitting what runtime rejects.

Use existing fixtures and focused tests. After one instrument-only checkpoint,
attempt the primary connected journey; do not accumulate validators without
exercising delivery. Retain isolated-mode regression coverage and remove obsolete
serial-path test setup rather than duplicating the full suite.

### 3. Isolated live proof and rollout

Run the complete serial journey in a disposable project, including real local
coordinator/executor tasks, native reporting and task archival. Verify retained
source, refs and checkout after each archive and then complete a useful successor.
Keep the outer delivery runtime stable; stage the candidate separately. Coordinate
any shared install/restart with active projects. Release one useful validated
package without republishing intermediate versions. Broaden pilots only after
explicit approval; no automatic conversion of current projects.

## Acceptance evidence

- Both coordinator-only and coordinator/executor serial journeys complete with
  no additional Git worktree, executor branch, synthetic merge or retained-checkout
  deletion. Source commits are correctly attributed and verified.
- Competing writer starts, stale handoffs and old/new namespace overlap are
  rejected. Crash/dirty-result cases do not silently admit another writer or lose
  edits. Source drift and background-writer limitations are documented honestly.
- At least one interruption during ownership transfer is resumed from existing
  durable facts without two writers or falsely completed work.
- Stale activation replay cannot regain transferred permission. A check that
  advances clean HEAD cannot certify the new revision from earlier test results.
  Dirty/rejected direct work remains preserved and non-unblocking.
- Exact task identity and reporting remain valid when tasks share a path; path
  equality is not identity. Test stale/late reports and same-path route/locator
  discovery so one task cannot consume another's result or retirement authority.
- Native archival leaves the retained checkout, branch and useful bytes intact;
  only eligible exact task records/routes retire. Ambiguous archive outcomes are
  observed, not replayed. Successor admission works after full closeout.
- The explicit isolated path and pinned historical assignments keep their
  existing semantics. No mass cleanup, journal rewrite or silent mode conversion.
- Historical retained results remain valid after successor commits. Delayed final
  capture is handled before reporter retirement, separately from writer release.
- If only slice A is approved for delivery, report isolated-executor resource
  costs honestly; do not claim the no-extra-worktree B acceptance requirement met.
- Report removed stages/resources and actual user interventions versus the old
  isolated journey. Report test elapsed time; no arbitrary LOC or speed target
  and no claim that fewer mechanisms alone proves correctness.
- Focused checks first; one proportionate final combined suite. Distinguish
  source tests, native feasibility and full live lifecycle evidence. Do not claim
  uninterrupted success when a canary required manual repair.

## Execution authority and escalation

The user authorized plan revision and the native probe, including its exact
disposable local task creation and archival. No Plotloom task, source, installed
plugin, shared setting, marketplace or restart is in scope. The director runs the
probe and retains its evidence externally. Runtime implementation is not dispatched
by this approval. After the gate/inclusion decision, the director prepares one
assignment for a Sol-high coordinator because this changes interacting ownership
and lifecycle contracts. Use cheaper workers for bounded independent work when
useful; collect native subagent results before their owner ends its turn. The
director owns acceptance and any separate live canary coordinator assignment.

Use the currently supported isolated delivery path to implement this change;
do not depend on the unfinished serial runtime to deliver itself. Escalate for
unsafe host archival, unprovable write ownership, unavoidable dual lifecycle
engines, migration of live state, broader recovery semantics or changed acceptance.

## Deferred work

The preserve-and-reset plan is paused, not discarded. Existing public recovery
commands remain available under their current limits. Reassess that plan after
the serial path reveals which failure and cleanup obligations still exist.
