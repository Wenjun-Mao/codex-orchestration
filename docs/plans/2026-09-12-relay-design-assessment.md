# Relay checkpoint 1: extraction and minimal contract

Status: bounded source assessment complete; proposed design pending external
review and approval, not implementation authority. Companion decision material for the
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

The next decision is approval or targeted revision of this minimum design after
two complementary reviews, not immediate implementation or another general audit.

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
   One start operation establishes or resumes its source permission and reporting
   setup. An interrupted start reconciles existing facts; it does not create a
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
generation. A lock protects transitions; it does not physically prevent arbitrary
shell/editor writes. The owner must account for background tools before transfer,
and validation detects unexplained source drift. No leases or automatic takeover
unless a real unmet requirement justifies them.

History is evidence, not a second permission system. Prefer a versioned Relay
record contract over a namespace per package release. Upgrades occur at settled
assignment boundaries; unsupported record versions stop explicitly. Do not add
live migration or make future admission replay every old runtime and live checkout.
The retention and compatibility details need review before implementation.

## Public interface and provisional startup budget

Design the public workflow around intent: prepare, start/resume, hand off,
verify/finish, accept/retire, and recover an exact stopped assignment. These are
operations, not a finalized CLI spelling. A coordinator should not separately
discover run, workflow, runtime-context, report-route and locator request schemas.

The prepared first prompt should contain: outcome and scope, approved plan link,
explicit selected role/model, exact startup command, and the few behavior rules
that affect work. Generated authority belongs in referenced machine data, not a
large human-authored prompt. Native actions remain visible, scoped tool calls.
Ambiguity returns one precise pending action rather than a repair scavenger hunt.

Proposed budgets for reviewers to challenge:

- One ordinary coordinator startup command; no more than three protocol command
  invocations on successful cold start, including required preflight. Count native
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

## Smallest useful acceptance set

Use existing test tools, not a new testing framework:

- Pure tests for ownership/transition eligibility, stale generation, routing and
  scope comparison where no actual Git/host state is required.
- Connected real-Git/CLI tests for solo and sequential executor results, failed
  startup, interrupted transfer, dirty/rejected work and verification subject drift.
- One accumulated-history test: completed assignments, a safely retired no-work
  failure, advancing retained HEAD, then a legitimate successor. No old outcome
  rewriting, historical checkout recreation, or whole-namespace deletion.
- Real native task/report/archive proof only for host-dependent assertions.
  Include delayed/duplicate final delivery and ambiguous host response observation;
  never treat synthetic hook invocation as native idle-final evidence.
- Inspect the built package's dependency closure, not only imports of its entrypoint.
  Benchmark focused checks and the final acceptance run independently.

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
