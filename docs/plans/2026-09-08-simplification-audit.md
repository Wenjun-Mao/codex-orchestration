# Codex Flow simplification audit

Status: Approved — user authorized execution on 2026-09-08.

## Outcome

Find the smallest coherent contracts and test strategy that support ordinary
delivery reliably and cheaply. Produce a ranked **remove / combine / retain**
decision list and one smallest implementation checkpoint, not a rewrite or a
line-count target. Include test runtime, model effort and operator interventions
as costs alongside source complexity.

v0.9.9 is paused, not accepted: tagged commit
3c1298d36c5d521d67637e70dff7bceb292335f3 passes 189 tests, but the installed
manifest cachebuster conflicts with Flow's exact-version guard. Preserve the
tag, artifact and coordinator worktree. Do not start another patch release
merely to enable this read-only audit.

## Cleanup before audit: completed and deferred

Read-only inventory authenticated the primary checkout at 67f3335 and ten
additional Git worktree registrations. Six unattached local branches were
deleted with non-force `git branch -d`; every tip is an ancestor of primary:

| Removed local branch | Preserved tip |
| --- | --- |
| codex/refresh-already-terminal-review | 9bf2d486c626da20b053a163ca30f97a461e5c38 |
| codex/research-routing-evidence | 814b7122bc276b204e2a1092fd679a1aac564f46 |
| codex/v0.9.3-planning-queued-reporting | 4fe042c7eae3ee7e564b9cb0327431a6da9f11e7 |
| codex/v0.9.5-lean-delivery | dc5c56fd3f1e8abe4784f890624ec947ed0ac51f |
| codex/v0.9.6-refresh-license-docs | ef78c35ef9e35afe722e317f9d89026b75941040 |
| codex/v0.9.7-assignment-closeout | e45b183def695232e430c46e45548e6f79182f47 |

No remote refs, tags, task records or worktree directories were deleted.
Remaining worktree classification (paths below are under
/Users/wjmao/.codex/worktrees unless noted):

- Preserve primary/director checkout, main and the current primary branch.
- Preserve 7fe0/codex-orchestration: paused v0.9.9 coordinator and release.
- Preserve bccd/codex-orchestration: untracked content; no discard authority.
- Pending historical closeout: 38ca, 43fe, 51d5, 5dab, bf06, d169 and f43c,
  each ending in /codex-orchestration. Tracked/untracked Git status was clean
  and each HEAD is preserved in primary, but clean Git is not proof of current
  archival or lifecycle eligibility. No host archive action was replayed.
- Pending stale registration: /private/tmp/codex-orchestration-v091rc1-d9e2c93
  is absent/prunable and its commit is preserved. No broad prune was run.

The current registry contains only the retired v0.9.8 iteration, not these
historical members. Installed CLI metadata failure prevents ordinary Flow
cleanup. Do not manufacture membership, bypass a lifecycle, or prolong this
audit's prerequisite with a cleanup framework. Unresolved resources remain
preserved and become concrete audit evidence; an explicit cleanup disposition
can be proposed separately.

## Read-only audit scope

1. Trace one real user journey: plan → dispatch → useful work → report →
   acceptance → archive/reclaim → next assignment, including zero-child work.
   Name the single owner of each fact and find duplicate/conflicting authority
   across runs, assignments, iterations, reports, Git and refresh.
2. Examine package → artifact → marketplace root/source → installed cache →
   loaded skills. Separate semantic release identity from distribution metadata;
   identify the earliest sufficient real installed-CLI check. No cache edits,
   installation, restarts or tolerances introduced during the audit.
3. Review compatibility capsules, recovery branches, module boundaries, skill
   verbosity and manual sequencing. For every proposed removal, identify the
   consumer and exit condition; historical failure alone is not a reason to
   retain executable compatibility forever.
4. Audit test cost and fidelity as described below. Prefer a representative
   integrated journey plus focused invariants over repeated expensive setup.

## Test simplification and timing

Baseline evidence: reported stable suite 189/189, 269.9 seconds on the user's
M5 Pro MacBook. The npm script serializes test files with --test-concurrency=1.
This is a lead, not a diagnosis or proof that higher concurrency is safe.

- First use existing TAP/timing logs and inspect fixtures, subprocesses,
  historical tag extraction, Git repository setup, large-file generation,
  sleeps, repeated validation/packaging and global/shared-state assumptions.
- If existing timings are insufficient, permit at most one instrumented full
  run of the exact source candidate, without editing tests or production code.
  Store temporary output outside source; identify revision, Node version,
  concurrency and machine conditions. Do not silently benchmark primary's
  older 0.9.8 checkout or compare unlike configurations.
- Rank expensive tests/files by measured contribution; distinguish fixture
  setup from useful assertions and subprocess/I/O/wait overhead where evidence
  permits. Avoid attributing total time to hardware or model choice.
- Classify checks as fast logic, real-Git integration, packaging/installation,
  or live App acceptance. Recommend focused development commands and a complete
  release gate without dropping required coverage.
- Identify duplicated scenarios and fixtures that can be safely shared;
  investigate parallelism only with isolation evidence. Do not blindly remove
  serialization, add caches, replace all real Git with mocks, or inflate timeouts.
- Map every proposed test deletion/combination to the invariant and remaining
  test that protects it. Preserve meaningful negative, recovery and first-turn
  ordering coverage. Set performance targets only after measuring, not an
  arbitrary seconds/test or percentage reduction goal.

## Deliverable and decision

One concise report, outside packaged authority, with:

- a small ownership map and ranked remove/combine/retain list;
- evidence, expected benefit, risk, affected invariants and exit conditions
  for each recommendation;
- measured test-cost concentration and coverage-preserving simplifications;
- explicit disposition of v0.9.9 installation failure and historical leftovers;
- one smallest direct implementation checkpoint and acceptance checks.

No standalone dashboard, registry, benchmark framework, daemon, migration
engine or sweeping module rewrite. The audit itself is the deliverable; stop
when a decision can be made rather than repeatedly expanding instrumentation.

## Execution and authority

Director owns synthesis and acceptance. Once approved for execution, use one
bounded independent review lane only if it adds distinct value; do not reuse
the paused release coordinator as an automatic implementation continuation.
Do not create nested coordinators.

Inspection may use source files and read-only tools without claiming an active
Flow run. Disclose the installed-CLI blocker; do not fabricate admission or
report receipts. No AGENTS.md reads/edits, pilot contact, repository cleanup,
source/test edits, installation, tagging, publishing or merging in the audit.
Durable architecture changes and implementation require a reviewed subsequent
checkpoint. Preserve the original untracked v0.9.9 plan and all existing work.
