# Stage-connection audit — simplification, part 2

Status: Approved — user authorized audit and coordinator dispatch; implementation and release remain paused.

## Outcome and authority

Find where adjacent Flow stages disagree, identify the owner of each shared
decision, and recommend the smallest coherent correction needed to finish
v0.9.10. Cover the complete workflow's connections, not every source file or
every historical version. RC2 preservation ownership is the first case, not
the entire scope.

Primary outcome: a decision-ready audit report, not new instrumentation.
Causal question: can each downstream stage consume the state and evidence its
upstream stage legitimately accepted, without undocumented intervention?
Cheapest safe direct attempt: trace the preserved RC2 failure through the real
command handlers and their existing tests, then apply the same check to the
remaining connections.

Audit RC2 source at `1d5595621f1b6d5afaf3daa3f38cb359fa3f8759` in
`/Users/wjmao/.codex/worktrees/fd80/codex-orchestration`. Authenticate that
revision before inspection; the director's checkout is older and is not the
implementation authority. Installed distribution is
`0.9.10-rc.2+codex.20260909030618`; its active run retains its immutable snapshot.

Reuse:

- [First simplification audit](../research/2026-09-08-simplification-audit.md).
- [Approved release plan](2026-09-08-v0.9.10-identity-and-closeout-simplification.md).
- RC2 failure evidence at `.git/codex-release-evidence/v0.9.10-rc.2/1d55956/live-owning-host-closeout-pause.md`
  in the primary repository; follow its exact journal references read-only.
- Existing CLI tests, invariant maps, release records and prior timing results.

The existing release coordinator and run `v0910rc2-live-owning-host` remain
paused. Successful executor acceptance and archival are not undone; iteration
closeout is still incomplete. Do not treat this audit as another repair cycle.

## Coverage

Trace these connections through their actual public commands and shared code:

| Connection | Principal question |
| --- | --- |
| Plan → assignment → run/launch | Do intent, recipient, ownership and selectors survive dispatch without conflicting identities? |
| Loaded distribution → refresh inspection → activation | Does the recommended route actually admit the same authenticated state, with fresh checks at mutation time? |
| Launch → first-turn start → result | Do provisional/ready identity and branch attachment converge without a second prompt or invented evidence? |
| Result → disposition → integration/no-change → verification | Can an admitted result reach its intended terminal outcome under the same selector, revision and baseline rules? |
| Accepted result → archive → reclamation → iteration/run closure | Which checkout or durable ref preserves whose work, and can each legitimate intermediate state proceed safely? |
| Closure → reporting/acceptance → route retirement → next assignment | Do different lifetimes remain coherent without premature retirement, lost finals or resurrecting cleaned resources? |

For each connection record: producer and consumer, authoritative evidence,
decision owner, expected next step, conflicting or repeated rules, existing
test coverage, and any remaining uncertainty. Distinguish intentional new
checks from contradictions: earlier acceptance cannot guarantee that changing
Git/host state will remain valid indefinitely.

Use representative existing cases, not a combinatorial matrix: zero-child
coordinator work; no-change and mutating executors; a coordinator on a newer
delivery branch than primary; host archive with worktree present versus absent;
and refreshed versus source-pinned operation. Include direct-dispatch role
guidance where it changes one of these connections. Unsupported cases are
identified as unsupported, not silently turned into new requirements.

## Checkpoint 1 — Preservation ownership and the RC2 chain

Separate three questions that must not be conflated:

1. Where is an executor's accepted result preserved before its resources go?
2. Where is the coordinator's delivered result preserved before its resources go?
3. When and through which existing evidence does preservation responsibility
   transfer between them?

Trace creation/admission, no-change acceptance, host archive and iteration
reclamation. Determine whether RC2 exposed unsupported test topology, an
incorrect product rule, a missing transfer, or a combination. Do not assume
the primary checkout is always wrong or that any surviving branch is enough.
Account for host archival removing a worktree before Flow's later cleanup
check. Contrast no-change, exact integration and patch-equivalent preservation.

Record the intended rule, actual rule, missed test boundary and smallest
candidate correction. No fix, waiver, primary-branch movement or archive replay.
Continue directly to the remaining connection coverage; no interim framework.

## Checkpoint 2 — Remaining connections and synthesis

Complete the coverage table using code/schema/skill evidence and existing tests.
Classify each connection as consistent, contradictory, unsupported or unverified.
Rank concrete findings by user impact and likelihood, distinguishing observed
failures from static risks. Do not count each rejection site as a separate bug
when they share one cause.

Recommend tests only at demonstrated gaps. Prefer a few real command chains
and narrow pure checks over more fixtures, prose assertions or a new validator.
Name redundant coverage each proposed test could replace, when supported by
evidence. Do not promise runtime savings without measurement or infer coverage
from a passing test count.

Deliver one report at `docs/research/2026-09-09-stage-connection-audit.md` with:

- The connection/ownership table with source and existing-test references.
- Ranked root causes and honest coverage gaps, including RC2 disposition.
- Retain/combine/remove recommendations, preserving meaningful distinctions
  between reports, receipts, acceptance, archival and resource deletion.
- One smallest coherent implementation checkpoint to unblock v0.9.10, its
  affected command-chain checks and recovery implications for the pinned RC2
  run; do not assume new code can hot-switch that run.
- Explicit deferrals and any decision requiring user approval.

## Execution and verification limits

After approval, use one separate Terra-xhigh audit coordinator in the existing
saved project; no executor tasks or additional projects. Bounded independent
inspection of the paused delivery is the rationale for a fresh audit task.
Do not activate a competing Flow execution run in this repository. If ordinary
reporting requires one, use an explicitly disclosed manual report to the
director instead; no fabricated route or lifecycle receipt.

Only the audit report may be authored during execution. Product code, tests,
schemas, skills, installed packages, configuration, historical journals and
Git resources are read-only. No AGENTS.md reads/edits or pilot contact.

Default to static tracing and existing evidence. A narrowly selected existing
test may run only when needed to resolve a named uncertainty, after checking
that its writes are isolated to disposable fixtures. Record its command and
result. No full-suite rerun, new harness/test implementation, live App canary,
installation, restart, publication or cleanup action. Check report links and
`git diff --check`; confirm audited delivery source stayed unchanged.

Bound effort to one coverage pass and one synthesis pass. Do not recursively
chase unrelated architecture or predecessor history. If evidence is missing,
record an unverified connection and the cheapest follow-up instead of expanding
instrumentation. Material expansion requires a new decision.

## Acceptance and next decision

The director reviews the report against all six connections. Every connection
must have evidence or an explicit verification gap; every proposed removal must
identify the safety property retained elsewhere. RC2 must have a concrete
ownership recommendation, not merely a request to retry cleanup.

Audit completion does not accept v0.9.10, resume its coordinator, waive a failed
gate, or authorize any recommendation's implementation. Review the findings,
then approve a bounded correction plan separately. Keep audit-task closeout
separate from the paused release's resources.
