# v0.9 coverage map

v0.9 is a native-first architecture reset under active development. Accepted
public authority remains v0.8.3 until every automated gate and the live RC
canary pass.

## Automated authority

| Contract | Primary coverage |
| --- | --- |
| Workflow DAG, ownership, goal-proximate fields, selectors, and generated contracts | `workflow-plan-v09.test.mjs`, `v09-lifecycle-fixture.mjs` |
| Replaceable selector policy and deliberate overrides | `selector-policy-v09.test.mjs` |
| Typed Codex App evidence, ready/provisional/opaque shapes, duplicate discovery, and contradictions | `codex-app-adapter-v09.test.mjs` |
| First-turn launch, exact executor claim, linked-worktree activation, one-shot creation, crash recovery, and negative identity/Git cases | `task-launch-v09.test.mjs` |
| Full launch through callback, disposition, integration/no-change, verification, archive, cleanup, and audit joins, including callback-before-App-result selector enrichment | `lifecycle-v09.test.mjs`, `run-lifecycle-v09.test.mjs` |
| Quiet completion and separate one-shot urgent interruption | `lifecycle-v09.test.mjs`, `urgent-v09.test.mjs` |
| Explicit read-only native-subagent lifecycle and selector rejection | `subagent-v09.test.mjs` |
| Public/private archive evidence | `codex-app-private-archive-v09.test.mjs` |
| Exact v0.8.3 semantic refresh, dirty discard, branch/worktree deletion, target consumption, and crash boundaries | `refresh-v09.test.mjs` |
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

Stable promotion is blocked until one same-coordinator App canary proves:

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

An App-facing failure blocks stable release. Its root cause must be classified
as adapter or core, receive a regression, and have the failed canary segment
repeated.

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
