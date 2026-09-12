# Relay checkpoint 1: extraction and minimal contract

Status: bounded assessment complete; targeted review amendments approved for
the connected source implementation. Native behavior remains unverified.
Companion contract material for the
[single Relay plan](2026-09-11-serial-first-delivery.md), not another execution plan.

Scope: source-only assessment. No Flow activation, native task creation, install,
product-project access, migration, or new implementation. Source reviewed at
`5d47f892b2c89b2e87333f772c0335b75fff7257`; this includes parked 0.9.14-rc.1 repair
work and is not the installed 0.9.13 package. Probe and startup evidence have their
own boundaries in the plan. Nothing here proves native Relay compatibility.

## Intended decision

Proceed with Relay only if its ordinary serial lifecycle can be owned independently
of Flow's lifecycle engine. Reuse leaf mechanisms where they fit; replacement of
the agent-facing interface and lifecycle is deliberate. Do not build parity or a
common evolving framework to preserve the legacy product.

The two complementary reviews are complete; see the
[synthesis](2026-09-12-relay-design-review-synthesis.md). The user approved the
targeted amendments and connected source slice. This is not deployment approval.

## Source dependency assessment

The read-only assessment found a viable small utility boundary, but no autonomous
Flow reporting package to reuse unchanged. The director cross-checked the decisive
route, runtime staging, native adapter, Git namespace and archive boundaries. This
is a source dependency cut, not proof that the extracted design works on the host.

| Treatment | Source evidence | Relay boundary |
| --- | --- | --- |
| Curate small utilities | [core.mjs](../../lib/core.mjs): canonical hashing, guarded JSON, atomic writes and locks; [repository-paths.mjs](../../lib/repository-paths.mjs) | Re-home only needed functions, with tests and Relay ownership; no runtime import of Flow |
| Rewrite direct verification around useful mechanisms | [git.mjs](../../lib/git.mjs)::discoverGit derives state from package version; [verifications.mjs](../../lib/verifications.mjs)::runCombinedVerification consumes Flow launch/receipt/disposition authority | Exact repository/checkpoint and direct result verification, without integration records or version namespaces |
| Conditionally extract native queue operation | [codex-app-report-adapter.mjs](../../lib/codex-app-report-adapter.mjs)::submitNativeQueuedReport takes recipient, delivery key and text; imports built-ins and core | Relay must supply its own sender/recipient authority, captured-final identity and durable pending outcome |
| Rewrite report authority and packaging | [report-routes.mjs](../../lib/report-routes.mjs)::registerCoordinatorReportRoute requires an active run and builds assignment/iteration authority; [report-records.mjs](../../lib/report-records.mjs) imports routes; [report-hook.mjs](../../lib/report-hook.mjs) stages pinned reporting authority | One Relay-owned reporting obligation and explicit minimal runtime manifest, not old route/run/iteration projections |
| Rewrite task-only archival | [archive-lifecycle.mjs](../../lib/archive-lifecycle.mjs)::resolvedTaskArchiveAuthority and reconcileTaskArchive couple task archival to launch/disposition and worktree postconditions | Observe exact task archival without requiring deletion or freezing the retained source checkout |
| Omit legacy orchestration engine | Run lifecycle, assignment authority, iteration registry, task launch, integration, disposition, cleanup and refresh engines | Reference their failure lessons; do not transplant their state machines or compatibility obligations |

Correction after review: `core.mjs::withProcessLock` is **not safe to copy
unchanged**. Its automatic stale-lock reclamation can rename a replacement live
lock after inspecting an earlier stale lock. Source inspection confirms that race
sequence; no executed reproduction or causal link to a product incident is claimed.
Relay initially refuses an existing transition lock. Explicit recovery requires
stopping competing operations and identifying the abandoned lock; rereading a token
before rename does not make reclamation atomic. A different tested primitive may
replace this approach only if it remains smaller and satisfies the same contract.

The decisive packaging leak is
[report-runtime.mjs](../../lib/adapters/codex-app/report-runtime.mjs)::runtimeSourceFiles:
it recursively stages **all of `lib`**, not just reporting imports. Narrowing one
entrypoint therefore does not produce a small independent package. Relay's built
artifact must have an explicitly checked Relay-only dependency closure.

Two host limitations remain open. The queue adapter pins a ChatGPT.app binary path
and CLI `0.153.4`; those source constants are not evidence of current compatibility.
Also, report submission acceptance means native queue acceptance, not confirmed
recipient-visible delivery or director acceptance. Reuse of the transport is
conditional on current host qualification; it must not import legacy lifecycle
authority or turn an ambiguous outcome into success.

The proposed short startup cannot be achieved merely by reusing Flow's public
registration unchanged: that preserves its run, assignment, iteration, locator and
runtime-staging obligations. A Relay-owned operation can hide mechanical steps
from the agent, but the assessment does not yet establish its cost or correctness.

## Proposed minimum responsibilities

These are semantic responsibilities, not a demand for five databases, public
state machines, layers, or services. Prefer a small local package and coherent
records over multiple projections of the same fact.

| Responsibility | Necessary facts / operations | Deliberately absent |
| --- | --- | --- |
| Assignment and current source permission | Intent, exact task identity, selected checkout/branch, checkpoint, current writer or verifier, transfer generation | Separate run/iteration completion ladders; default executor branches |
| Direct result verification | Producer, baseline/result revision, scope, tests bound to the tested subject, accepted/failed/unresolved disposition | Merge/cherry-pick requirements; synthetic integration records |
| Prepared native actions | One intended creation/archive, exact known or provisional identity, observed outcome and ambiguity | Competing archival app-server, background daemon, guessed retries |
| Reporting | Exact sender/recipient, captured final, delivery state, acceptance and pending retirement | History granting write authority; whole-repository routing scans on every hook |
| Thin public interface/package | Generate mechanical inputs; concise actionable output; explicit selectors | Agents discovering schemas; legacy lifecycle imports or all-of-lib staging |

One semantic assignment is enough unless evidence demonstrates another owner is
essential. Do not collapse writer release, result acceptance, report delivery and
task archival into one success flag: they are independently observable and can
finish at different times. They need clear owners, not duplicated completion claims.

## Proposed serial contract

1. Director prepares intent, scope, acceptance and explicit staffing choices.
   Code generates identities, native-action arguments and the first prompt.
2. The exact created coordinator starts against the chosen clean checkpoint.
   One start operation establishes or resumes its reservation. Required reporting
   bindings/setup must be persisted before source permission becomes write-enabled.
   An interrupted start reconciles existing facts; it does not create a
   competing assignment. Any provisional identity join is monotonic and must be
   qualified against the actual native surface, not assumed from the ready probe.
3. A coordinator may work locally or prepare a sequential executor handoff.
   The verified checkpoint passes to the intended executor; the coordinator
   cannot edit during executor ownership. A result passes into coordinator
   verification ownership without an available-to-any-writer gap.
4. Verification checks producer identity, per-commit write scope, source ancestry,
   cleanliness and the exact tested revision. A later edit requires a new current
   permission/checkpoint. Source-changing checks invalidate their own earlier proof.
5. Successful delivery releases source ownership at its verified checkpoint, while
   final reporting remains possible. Director acceptance and eligible task archival
   finish their own obligations without Git deletion. The next legitimate owner
   does not depend on a historical checkout vanishing or staying frozen forever.
6. Failed or interrupted work never satisfies dependencies. Recovery establishes
   quiescence, preserves/disposes of the actual source outcome under explicit
   authority, and retires the old permission. A no-work failure can settle without
   fabricated success; dirty/rejected work cannot silently unblock a new writer.

Every supported write-enabling start/resume checks the current permission and
generation. Persist supporting immutable result/report facts before atomically
replacing the current control record: that replacement is the single ownership
commit point. An interrupted operation reconciles its same intent; orphan supporting
facts never grant permission. Executor finish replaces executor permission directly
with the named coordinator's reservation to verify the exact result revision.
Notification does not grant that permission. Never expose an available slot in between.

A short command lock protects transitions, not model/host waiting time, and does
not physically prevent arbitrary shell/editor writes. Prohibit detached
source-changing tools across handoffs. Unknown surviving writers require explicit
recovery, not automatic takeover. Verification checks must not modify tracked
source, index or refs; run fixers as work and verify again. Endpoint comparisons
detect drift, not every transient write; do not add filesystem surveillance.

Recovery has two release predicates. A reservation that was never write-enabled
may be irrevocably revoked, rejecting every late start while retaining unresolved
native-task facts. A possibly write-enabled owner remains blocking until quiescence
and explicit disposition of the actual source, including untracked and rejected
committed work. A clean rejected commit is not automatically an approved baseline.
Recovering a command lock alone proves neither predicate.

History is evidence, not a second permission system. Prefer a versioned Relay
record contract over a namespace per package release. Upgrades occur at settled
assignment boundaries; unsupported records stop only operations that need them.
Unrelated settled history does not block admission. An upgrade unable to service
pending obligations waits for them to drain; ordinary successors need not wait.
Do not add
live migration or make future admission replay every old runtime and live checkout.
Admission reads current authority, the requested assignment and its relevant
dependencies, not a replay of all historical runtimes or live checkouts.

## Reporting and operation-specific gates

Reporting facts belong to the assignment, not a parallel authority hierarchy.
A minimal sender-index pointer may locate them; a checkout path cannot identify
the sender. Before source release, seal result association, sender, recipient and
finishing-event correlation. Final bytes may remain capture-pending until the real
native final. A late hook reads this frozen association, never current HEAD or the
newest assignment. Exact event correlation remains a native qualification gate.

Same event/same bytes is idempotent; same event/different bytes conflicts. Persist
attempt-before-send. An ambiguous submission waits for exact observation or explicit
reconciliation; do not resend automatically. Queued, recipient-confirmed and
accepted remain distinct facts. One recipient operation may record receipt and its
separate accept/reject decision together; receipt without acceptance is supported.
The hook transports the final; it does not certify successful source work.

| Pending fact | Blocks | Does not automatically block |
| --- | --- | --- |
| Ownership, verification or unresolved possible writer | Another source owner | Read-only reporting/observation |
| Dirty/rejected source without disposition | Ordinary source admission | Sole-owner explicit recovery |
| Final capture | Archiving the surface needed for capture | Independent work after safe source release |
| Uncertain report delivery | Claiming delivery or discarding required evidence/capability | Unrelated safe source work |
| Result acceptance | Work depending on that accepted result; ordinary success archival | Explicit independent work at a safe approved baseline |
| Unobserved archive | Claiming archival or forgetting the operation | Successor work after task-only archival is qualified |

Failed/cancelled retirement does not require successful acceptance. Archive only
the exact eligible quiescent task after permission retirement and the required
task-specific reporting decisions. Absence from a list is not affirmative archive
evidence. Observe ambiguous host outcomes without replay; never require historical
HEAD or checkout disappearance. Until post-archive reporting is qualified, delay
the sender's archival rather than all successor source work.

## Public interface and provisional startup budget

Design the public workflow around intent: prepare, start/resume, hand off,
verify/finish, accept/retire, and recover an exact stopped assignment. These are
public operations whose option syntax is finalized during implementation. A coordinator should not separately
discover run, workflow, runtime-context, report-route and locator request schemas.

The prepared first prompt should contain: outcome and scope, approved plan link,
explicit selected role/model, exact startup command, and the few behavior rules
that affect work. Generated authority belongs in referenced machine data, not a
large human-authored prompt. Native actions remain visible, scoped tool calls.
Ambiguity returns one precise pending action rather than a repair scavenger hunt.

### Complete public journey

Names below define the intended public operations, not an already implemented CLI.
Generated commands carry exact handles; the agent does not author hashes or schema
bindings. Implement help/examples alongside the operations, not afterward.

| Actor / operation | Genuine input or observation | Required outcome / next action |
| --- | --- | --- |
| Director: `prepare` | Outcome, scope, checks/acceptance, selected checkout/branch, saved native project, coordinator selector and exact recipient | Capture clean baseline; reserve assignment; generate native creation arguments and first brief with exact `start` command. If project missing, name that prerequisite without creating project-management machinery. |
| Director: native creation, then `record-native` | Actual creation result for the prepared action | Bind exact ready identity or retain provisional/ambiguous intent. Return exact observation/resume action; never repeat uncertain creation. |
| Coordinator: `start` | Generated assignment handle; actual actor identity | Check current generation, source and reporting readiness. Return READY with owner/checkpoint/scope and generated next command, or NOT READY with actor, allowed activity and one exact next action. Early/provisional identity gets no writes. |
| Coordinator: `handoff` | Bounded subtask, permitted scope, checks, executor selector | Reserve exact clean checkpoint, suspend coordinator editing, generate one native creation/identity-binding path and executor brief. |
| Executor: `start`, work, `finish` | Generated handle; actual product work | Derive result/producer/scope; preserve final-report obligation; transfer directly to coordinator verification reservation. Do not self-accept the result. |
| Coordinator: `verify` | Semantic review plus continue/finish/reject decision | Run recorded checks against exact reserved subject, compare source before/after, bind evidence. Continue gets a new work checkpoint; reject retains explicit recovery; finish releases verified source with capture pending. |
| Solo coordinator: `finish` | Completed work and selected checks | Use the same verifier in one public operation; no synthetic integration or extra ceremonial verify call. A failed check does not produce success. |
| Sender: actual native final | Real final event and bytes | Capture once against frozen assignment/result; record submission and observation separately. Do not synthesize idle evidence. |
| Director: `receive` / `accept` or `reject` | Exact received report and independent review decision | Record receipt without forcing acceptance; permit combined receipt/decision. Return the next eligible task-only archive action, not a task-list reconstruction request. |
| Owning actor: native archive then `record-native` | Exact prepared host action result and archive observation | Retain ambiguity or conclude task archival without Git deletion. Return outstanding task-specific obligation or retired status. |
| Authorized owner: `recover` | Generated exact stopped assignment/action handle and actual source-resolution decision | Apply the never-enabled or possibly-enabled predicate. Preserve failure and uncertain native actions. Return safe checkpoint or exact blocking action; never a generic start-over instruction. |
| Director: next `prepare` | New approved intent and any explicit accepted-result dependency | Read current checkpoint/permission, not historical live HEAD. Allow independent work despite unrelated pending reporting/archive facts. |

Normal admission consists of prepare (handoff for an executor), record-native and
start. Native creation is separately counted. A child racing identity recording
gets binding-pending; the creating owner records the result and sends the returned
resume action. Count this extra exchange when it occurs; do not hide it in budget
claims or add an unattended wait mechanism. Unknown identity stays pending until a
bounded exact observation is available; generic provisional reconciliation is deferred.

An interrupted `start` retries the same handle. If only reserved, output remains
write-disabled until bindings/setup finish. If permission could already have been
enabled, recovery treats it as a possible writer, even if READY output was lost.
No public command asks the model to manufacture passing checks, source snapshots,
producer identities or a new assignment to evade an interrupted operation.

Proposed budgets for reviewers to challenge:

- One ordinary coordinator startup command; no more than three protocol command
  invocations on successful cold start, counting preparation, native-result binding
  and start (preflight included). Count native
  creation separately and report both counts; do not hide setup in child agents.
- At most 6,000 newly introduced plugin-specific model-visible tokens from brief,
  instructions, generated requests and tool outputs through source-ready status.
  This is a design target, not an observed result or a claim of percentage savings.
- Zero plugin implementation reads and zero handwritten mechanical protocol JSON.
- Report startup elapsed time, separating native provisioning/model latency from
  local protocol work. No latency claim is established yet.

Measure with a fresh coordinator using only published public instructions, for
both solo and delegated starts. Report product-plan/code reading, ambient App
context and cumulative API usage separately; do not equate any of them with the
user's unverified >100K context estimate. Budget overruns require explaining the
necessary information or simplifying the interface, not merely shrinking output
while keeping equivalent hidden work.

Measurement begins when approved intent is ready and preparation starts; include
director/coordinator or coordinator/executor windows and their total. Count repeat
reads and any helper work, not just the new worker's prompt. Use the required native
acceptance journeys rather than a separate benchmark program. Save actual visible
spans; state tokenizer/version, or report bytes with a labelled estimate. Two runs
provide raw values, not a reliable percentile or percentage-saving claim.

## Smallest useful acceptance set

Use existing test tools, not a new testing framework:

- Pure tests for ownership/transition eligibility, stale generation, routing and
  scope comparison where no actual Git/host state is required. Include deterministic
  lock contention/recovery and interrupted ownership commit-point cases.
- Connected real-Git/CLI tests for solo and sequential executor results, failed
  startup, interrupted transfer, dirty/rejected work and verification subject drift.
- One accumulated-history test: completed assignments, a safely retired no-work
  failure, advancing retained HEAD, then a legitimate successor. No old outcome
  rewriting, historical checkout recreation, or whole-namespace deletion.
- Real native task/report/archive proof only for host-dependent assertions.
  Include delayed/duplicate final delivery and ambiguous host response observation;
  never treat synthetic hook invocation as native idle-final evidence.
- Inspect the built package's dependency closure, not only imports of its entrypoint.
  Unpack outside this repository and run CLI/hook tests with Flow unavailable;
  check dynamic loading and runtime staging too. Benchmark focused checks and the
  final acceptance run independently. Do not transplant the legacy full suite.

## Review questions and boundaries

Lifecycle reviewer: which proposed facts are essential, which duplicate others,
and which operation owns safe recovery? Find a concrete counterexample involving
stale ownership, reporting delay, source changes or task-only archival. Suggest
the smallest correction, not an additional general subsystem.

In particular, specify the verification reservation during handoff, which pending
report/archive obligations actually block a successor, and what observation can
retire a task while its shared checkout remains usable. Queue acceptance alone
must not stand in for recipient delivery; delayed reports must not regain source
permission. Avoid making every outstanding housekeeping action a global blocker.

Interface reviewer: can a fresh coordinator complete the journey without internal
code knowledge? Challenge the startup budget and generated-versus-authored inputs.
Identify hidden lifecycle/packaging costs and a smaller practical public surface.

Challenge whether reporting needs its own record or can remain an obligation on
the assignment without duplicating authority. Require a minimal file manifest and
a bounded host-compatibility check before relying on the existing native queue
mechanism. Flow/Relay hook coexistence and provisional creation remain unproven.

Both reviewers should separate source observations, proposals and unverified host
assumptions. Existing probe facts do not prove new runtime behavior. No feature
parity, concurrency mode or support for all historic Flow failure combinations is
requested. Relay may refuse repositories still controlled by Flow; adoption is a
separate preservation-first boundary, not automatic journal translation.

The user authorized publication on a review branch and two self-contained
copy/paste prompts. The handoff supplies the immutable published packet commit
after remote/access verification; it is distinct from the source anchor above.
Active product projects and installed plugins remain untouched.

Assessment verification: read-only source inspection and documentation link /
whitespace checks only. No tests or native probes were run; no implementation,
installation or product-project mutation occurred during assessment. Subsequent
review-branch publication is documentation handoff, not release validation.
