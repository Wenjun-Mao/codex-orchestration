# Simplification audit: fewer authorities, more representative tests

Status: audit findings; no implementation or release acceptance authorized by this report.

## Recommendation

Do not reset the architecture. Consolidate duplicated authorities and exercise
the actual operating path. First restore installed-package usability with one
shared identity contract. Next remove the obsolete closeout implementation
after transferring its unique protections to the production path. Test cost
should be reduced through fixture and scenario design before guessing at
parallelism or deleting safety coverage.

## Evidence boundary

Audited source: clean v0.9.9 worktree at
`3c1298d36c5d521d67637e70dff7bceb292335f3`, not the director's older v0.9.8
checkout. Source citations below refer to that preserved worktree. Production,
tests, Git state, installed packages and pilot repositories were not changed
by the audit. Only the approved plan and this report were written. One
independent Terra-xhigh read-only reviewer owns the test-cost measurement.

The real installed CLI was called read-only with the correct refresh skill and
exited 1: `Installed codex-orchestration package metadata must exactly match
version 0.9.9`. Thus the published tag is preserved, but v0.9.9 operating
acceptance remains withheld. Passing source tests is not installation proof.

## Small ownership map

| Fact | Current authority | Simplification direction |
| --- | --- | --- |
| Approved intent and recipient | Preparation/assignment snapshot | Retain; one plan, no repeated model-authored checksum ceremony |
| Active work, selectors, dependencies and fences | Run/workflow/launch or local-work record | Retain immutable execution identity; derive summaries rather than restating them |
| Task owns this actual worktree | App evidence, currently read twice | One adapter; core consumes typed evidence |
| Verified result and preserved revision | Local-work or executor receipt/integration/verification | Retain exact evidence; acceptance should reference it before resources disappear |
| Final text reached the queue | Report record/route/locator | Keep separate from correctness and director acceptance |
| Director accepted the result | Assignment acceptance | Retain; avoid inferring it from queue acceptance or task idle |
| Task archived, worktree reclaimed, branch absent | Owning-host observation plus Git evidence, coordinated by iteration | Separate facts, one transition implementation |
| New run may start | Run lifecycle plus refresh | A retired assignment should not require its reclaimed worktree to remain live |
| Installed distribution matches release | CLI, refresh, source validator and install procedure | One release/distribution identity rule, checked on final installed bytes |

Separate records are not inherently duplication: active-run safety and
assignment-lived reporting have different lifetimes. Do not merge all state
into a global registry, equate reports with receipts, or replace explicit
archive outcomes with elapsed-time guesses.

## Ranked remove / combine / retain findings

### 1. Combine installed identity checks — immediate usability blocker

Exact manifest/package equality appears in the [CLI](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/bin/codex-flow.mjs:266),
[refresh authentication](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/lib/compat/refresh.mjs:800),
[refresh target validation](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/lib/compat/refresh.mjs:386)
and [source validation](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/scripts/validate.mjs:239).
The local plugin-update procedure adds `+codex.<cachebuster>` to the distribution
manifest. Fixing just the CLI would leave later rejection sites.

More importantly, [the installed-CLI test](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/test/cli-v09.test.mjs:67)
explicitly expects that cachebuster to be rejected. This is a wrong expectation
relative to the installation contract, not merely absent coverage.

**Combine:** one pure release/distribution identity rule. Keep tagged source
metadata exact; allow only the explicitly supported distribution transformation
at installation/refresh boundaries. Retain the full raw manifest version as
observed evidence and keep runtime namespace tied to semantic package identity.
Do not strip arbitrary suffixes or relax runtime/content checks. Verify artifact
payload equality with only the documented manifest difference permitted.

**Benefit:** removes sequential rediscovery of the same mismatch and prevents
restart requests from substituting for on-disk verification. **Exit:** one
cachebuster-stamped installed fixture reaches real refresh inspection, rejects
wrong base versions/malformed metadata, and all consumers use the same rule.

### 2. Remove the obsolete closeout path, combine its unique tests — high value

[closeoutIterationWithOwningHost](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/lib/iteration-registry.mjs:1603)
is used by the CLI and assignment acceptance. The separate
[closeoutIteration](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/lib/iteration-registry.mjs:1934)
still implements another archive/reclaim loop; all discovered in-repository
callers are tests. No production caller was found; external direct imports
were not surveyed and must be checked before removal.

**Remove/combine:** transfer unique concurrency, ambiguity, child-first,
preservation, dirty/shared-worktree and retry invariants to the owning-host
path, then remove the old implementation and redundant scenarios. Do not
delete those tests wholesale: some may be the only coverage of a protection.
**Exit:** one runtime closeout driver and a test-to-invariant map showing every
unique safety property retained on the actual CLI path.

Measured test attribution reinforces this priority: the 17 tests in the old
closeout-only block (lines 945–1689 of assignment-lifecycle) consume 52.250 s,
about 19.5% of the entire suite. The 13 owning-host cases consume 33.190 s.
This is not a promise to remove 52 seconds: unique invariants still need tests
on the production path. It identifies where consolidation can improve both
fidelity and runtime instead of trading one for the other.

### 3. Combine App worktree ownership observation — concrete layer violation

The new [coordinator adapter](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/lib/adapters/codex-app/coordinator-worktree.mjs:1)
and [governance iteration code](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/lib/iteration-registry.mjs:596)
both read `codex-thread.json`. The layer registry labels the latter core;
the validator's private-token blacklist simply does not include this filename.

**Combine:** one adapter observer supplied to the cleanup driver, including
other-worktree ownership checks. Keep path, common-directory, source/caller,
freshness and owner protections. Improve the boundary check after removing the
leak; adding a blacklist token alone would not fix the architecture.
**Exit:** core tests accept typed evidence without App-private files, and
adapter fixtures cover missing/contradictory ownership.

### 4. Consolidate result preservation at acceptance — important, later checkpoint

[Assignment acceptance](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/lib/assignment-authority.mjs:163)
stores report ID/digest and reviewer, but not a reference to verified Git result
authority. The new recovery must search completed-work records and join run,
plan, runtime and checkout after the checkout has disappeared. That is why an
apparently simple cleanup fix grew into another recovery path.

**Combine:** make the existing acceptance boundary retain/reference the already
verified result authority needed for later reclamation. Investigate this as a
single contract change, not another independent receipt journal. Derive
iteration summaries from accepted result plus host/Git facts. Keep historical
corrections explicit; do not silently rewrite old state or pretend every
coordinator has one local-work record. Mixed/multiple-result work needs an
explicit design before implementation.
**Exit:** ordinary complete → accept → reclaim → next assignment needs no
search for a missing result tip or live retired checkout.

### 5. Remove stale compatibility claims; bound retained capsules

[The compatibility register](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/docs/compatibility-capsules-v0.9.md:1)
lists three capsules, but not the new exact v0.9.7 settled-predecessor reader.
Mission text says targets never parse source journals, whereas that reader is
an intentional exception. Broad phrase-marker validation still passes both.

**Retain for now:** source-pinned active runs, exact provisional recovery and
private archival evidence with their real exit conditions. **Remove/combine:**
update one authoritative compatibility inventory and link narrative to it;
retire capsules only after supported consumers are demonstrably absent. Do not
assume every old project is settled. No fleet scan or migration was performed.

### 6. Thin wording checks and policy interfaces, not all safeguards

[Source validation](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/scripts/validate.mjs:438)
requires exact prose markers across skills, historical ADRs, release dates and
docs. These checks can preserve old wording while missing contradictory
meaning. Keep schema shape, links, package inventory and import direction;
replace selected prose-string assertions with behavioral checks at their real
boundary. Do not remove all documentation validation as a batch.

Nine skills total about 1,898 whitespace-delimited words; they are not the
largest demonstrated problem. Retain the concise role split and quiet reporting.
Challenge unused/duplicated policy entry points and required boolean staffing
forms only after checking consumers; do not expand model-routing research or
change model defaults as part of this audit.

## Test cost and coverage

One measured run of exact source 3c1298d, using `npm run test:v09`, Node
v24.18.0, arm64 on the M5 Pro host, with `--test-concurrency=1`:

- 189/189 pass; TAP duration 268.404 seconds, wall time 268.57 seconds.
- User CPU 104.02 seconds, system CPU 95.79 seconds; peak RSS about 268.4 MiB.
- Parsed individual test durations total 267.460 seconds. The differences from
  wall time are runner/startup overhead, not extra test cases.
- This reproduces the reported 269.9-second cost closely. It is one local
  observation under current machine load, not a reproducible benchmark study.

Raw temporary evidence: [TAP/timing log](/tmp/codex-flow-v099-test-audit-3c1298d.tap)
and [test-name mapping](/tmp/codex-flow-v099-test-names-3c1298d.txt). No existing
per-test log was found; all timing figures above come from this single run.
The summary is retained here because temporary logs may later be removed.

| File | Tests | Sum of test durations | Share of summed durations |
| --- | ---: | ---: | ---: |
| assignment-lifecycle-v097.test.mjs | 30 | 85.441 s | 31.9% |
| refresh-v09.test.mjs | 13 | 48.417 s | 18.1% |
| task-launch-v09.test.mjs | 10 | 25.502 s | 9.5% |
| report-hook-v093.test.mjs | 12 | 22.936 s | 8.6% |
| unplug-v09.test.mjs | 25 | 18.984 s | 7.1% |

The top two files consume about half the test time; the top five consume
75.3%. Optimize there, not by deleting cheap unit assertions across the suite.
The slowest measured cases include semantic v0.8.3 refresh (9.855 s), partial
task-start recovery (9.846 s), mixed refresh (8.495 s), and abandoned-source
refresh (6.690 s). These cover meaningful transitions and should not simply
be removed because they are slow.

[Assignment fixture construction](/Users/wjmao/.codex/worktrees/7fe0/codex-orchestration/test/assignment-lifecycle-v097.test.mjs:57)
creates a real primary repository, coordinator worktree and active executor
launch even for many tests centered on assignment/reporting state. Narrow
fixtures by scenario; keep full real-Git journeys where identity, attachment,
integration and reclamation are what the test proves. Share immutable prepared
inputs, not mutable journals across tests.

Transport rejection/overflow/stubborn-process coverage includes a measured
4.236-second case with intentional process budgets. Retain a small representative
real timeout test; test pure parsing/state transitions without repeated waits.
The CPU split is consistent with substantial process/filesystem work but does
not measure the exact causal contribution of each operation. No speedup estimate
is claimed without implementing and measuring a specific change.

Suggested testing layers: fast pure contracts; isolated real-Git integration;
packaging/installed-CLI identity; and small live App acceptance. During edits,
run the affected layer; at a release candidate, run the complete required suite
once after changes settle. Inspect shared environment/process/global-directory
dependencies before attempting concurrency. Do not blindly change the serial
setting, replace all Git with mocks, add broad caches, or increase timeouts.

No second suite or source/test change was performed for this audit.

## Smallest next implementation checkpoint

**Installed identity only**, not the entire ranked list:

1. Record release identity versus distribution metadata once; share the rule
   across CLI and refresh while keeping tagged source validation strict.
2. Correct the cachebuster test's expectation; use the existing installation
   helper's output in an isolated fixture and run the real CLI with the exact
   refresh skill. Retain wrong-base/version/content rejection.
3. Authenticate resolved marketplace root/source before installation. Test final
   on-disk CLI usability before requesting an App reload. After reload, verify
   loaded skill authority separately. Cache equality is not CLI usability.
4. Use a new immutable version if shipped; never replace published v0.9.9.
   Run focused checks during development and one final complete suite for the
   settled artifact. No new canary project, daemon or broad predecessor reader.

After this restores usability, the next simplification candidate is retiring
the old closeout driver and restructuring its expensive fixtures. Neither is
silently bundled into the identity checkpoint. The measured test-cost findings
may refine that ordering.

## Cleanup and operating disposition

Six already-merged local branches were removed before this audit; those rows
in the plan are completed history, not future tasks. Historical worktrees with
unclear lifecycle ownership, one dirty worktree, the absent/prunable registration
and the paused v0.9.9 worktree remain preserved. They are not evidence of lost
commits, nor are they automatically eligible for deletion. Use a separately
bounded exact cleanup disposition; do not create fake iteration membership.

The source release and failed installed candidate remain intact. No pilot
recovery has been certified by this audit. The report proposes changes; it
does not accept v0.9.9 or restart its paused implementation.
