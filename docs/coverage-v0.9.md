# v0.9 coverage map

v0.9 is the accepted native-first architecture reset. Immutable `v0.9.0`
remains accepted public authority. Candidate `v0.9.1-rc.2` includes the
lifecycle-authority corrections and the version-bound maintenance-refresh fix;
promotion remains gated on exact-source replay and the release checks below.

## Automated authority

| Contract | Primary coverage |
| --- | --- |
| Workflow DAG, ownership, goal-proximate fields, selectors, and generated contracts | `workflow-plan-v09.test.mjs`, `v09-lifecycle-fixture.mjs` |
| Replaceable selector policy and deliberate overrides | `selector-policy-v09.test.mjs` |
| Typed Codex App evidence, ready/provisional/opaque shapes, duplicate discovery, and contradictions | `codex-app-adapter-v09.test.mjs` |
| First-turn launch, exact executor claim, linked-worktree activation, one-shot creation, crash recovery, and negative identity/Git cases | `task-launch-v09.test.mjs` |
| Full launch through callback, disposition, integration/no-change, verification, archive, cleanup, and audit joins, including callback-before-App-result selector enrichment and cross-revision task-disposition dependencies | `lifecycle-v09.test.mjs`, `run-lifecycle-v09.test.mjs` |
| Quiet completion and separate one-shot urgent interruption | `lifecycle-v09.test.mjs`, `urgent-v09.test.mjs` |
| Explicit read-only native-subagent lifecycle and selector rejection | `subagent-v09.test.mjs` |
| Public/private archive evidence | `codex-app-private-archive-v09.test.mjs` |
| Exact v0.8.3 semantic refresh, selected already-terminal evidence, dirty discard, branch/worktree deletion, target consumption, joined crash-replay boundaries, and exact closed-v0.9.0 no-replacement maintenance refresh | `refresh-v09.test.mjs` |
| Coordinator branch authority remains disjoint from executor cleanup branch fences at admission | `run-lifecycle-v09.test.mjs` |
| Version-agnostic clean-start unplug | `unplug-v09.test.mjs` |
| Schema/runtime parity and immutable release identity | `schema-runtime-parity-v09.test.mjs`, `release-identity.test.mjs` |
| CLI inventory, scoped help, and real activation wiring | `cli-v09.test.mjs` |

`scripts/validate.mjs` additionally enforces:

- exact schema and packaged-module inventories;
- the complete module-layer registry and legal import direction;
- syntax, literal dynamic imports, and zero third-party dependencies;
- no App-private vocabulary or current model names in governance core;
- absence of retired bootstrap, release, v0.7.8, and v0.8.1 executable paths;
- current skill, template, example, documentation, package, plugin, runtime, and
  state-namespace authority.

## Live RC canary

The same-coordinator App canary proved:

1. an exact v0.8.3 source run with two bounded visible executors;
2. one accepted result embodied in the baseline and one exact disposable lane;
3. App reload onto the v0.9 RC without replacing the coordinator;
4. semantic refresh preserving the integrated result and discarding only the
   unintegrated executor;
5. a replacement whose full contract is its first prompt and whose
   `task launch start` activates the branch before useful work in that turn;
6. no bootstrap-only final, waiting-for-release state, normal history scan, or
   second objective message;
7. successful terminal callback, integration, archive, cleanup, and removal of
   old task/worktree/branch/handoff/canary state; and
8. separately recorded App provisioning and Flow activation latency.

The complete result is recorded in
[`2026-09-04-v0.9.0-rc4-live-app-canary.md`](field-tests/2026-09-04-v0.9.0-rc4-live-app-canary.md).
The RC3 selector-evidence ordering failure was classified as core, fixed with a
regression, and the exact failed segment passed under RC4 before promotion.

The v0.9.1 maintenance canary then exercised two sequential real App tasks.
Task A completed under workflow revision 1; its exact completed disposition
lawfully admitted dependent task B under revision 2. Both tasks activated
distinct reserved branches, returned unchanged clean receipts, passed combined
verification, archived with typed private evidence, and left zero residue after
exact cleanup and unplug. The complete result is recorded in
[`2026-09-05-v0.9.1-rc1-live-app-canary.md`](field-tests/2026-09-05-v0.9.1-rc1-live-app-canary.md).

## Release gate

```text
npm test
npm run validate
npm run pack:check
git diff --check
annotated exact tag
artifact/cache byte equality
live RC canary PASS
```

After stable release, a new authority addendum—not a rewrite of the frozen
preregistration—pins v0.9.0 for the existing six-arm routing evaluation. That
evaluation is retrospective feasibility evidence and cannot silently change
the stable package.
