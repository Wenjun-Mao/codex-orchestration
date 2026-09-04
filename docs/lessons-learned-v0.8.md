# Lessons from v0.5–v0.8 carried into v0.9

This index turns repeated field failures into release gates. Historical details
remain in their ADRs and tags; this file records the reusable engineering
lesson and when its compatibility code may leave current authority.

| Failure | Root cause | Missed release gate | Durable guardrail and regression | Compatibility exit condition |
| --- | --- | --- | --- | --- |
| App provisional IDs failed safe-ID validation | A host-owned opaque identifier was forced into an internal identifier grammar. | No fixture used the App's literal provisional syntax. | Typed creation evidence keeps provisional values bounded but opaque; adapter fixtures cover literal current and future shapes. | Public API returns a stable ready ID directly; opaque evidence handling remains. |
| Linked worktrees failed runtime authority | Repository identity was compared by checkout path instead of Git common directory plus bound worktree evidence. | Tests used one checkout root. | Core authenticates common directory, exact baseline, non-coordinator worktree, branch, and cleanliness with real linked-worktree tests. | This is a permanent Git identity rule, not compatibility code. |
| Callback accepted selector claims that disposition later rejected | Admission and disposition applied different provenance rules to unavailable host observation. | Only each transition was tested, not the complete callback-to-disposition chain. | Terminal receipt v4 is checked against launch selector authority on delivery and again through a complete lifecycle test; unavailable remains null. | Permanent provenance invariant. |
| Tested worktrees appeared dirty because of ignored build output | Archive cleanliness treated ignored generated artifacts as source risk. | Fixtures lacked realistic ignored caches and build directories. | Tracked/untracked risk and ignored output are modeled separately; archive tests include generated ignored files. | Permanent cleanup rule. |
| Unplug could not inventory legacy top-level evidence files | Discovery assumed every namespace-root entry was a version directory. | Clean fixtures reflected only current layout. | Unplug classifies bounded non-symlink opaque entries by path, type, size, and digest and deletes exact state last. | Retain version-agnostic opaque discovery while such repositories exist. |
| New App turns invalidated approved unplug plans | Repository digest included host-managed ephemeral turn-diff refs. | Approval was not exercised across a real App turn boundary. | Host-managed turn-diff refs are observations; source, local, remote, tag, and cleanup-resource refs remain binding. A fixture adds an ephemeral ref between plan and apply. | Retire the exclusion only if the App stops creating those refs or provides a stronger classification API. |
| Detached host worktree reached release before branch binding | Host provisioning and Flow release were separate coordinator steps with an easy sequencing trap. | Happy paths manually bound the branch before release. | v0.9 executor `task launch start` owns authenticated branch intent/attachment before source mutation; real-Git crash tests cover both sides of the switch. | Old creation/release lifecycle is removed from current authority. |
| Scoped help threw a parser stack trace | Help was implemented only at the top level while skills instructed action-scoped discovery. | CLI tests checked only `--help`. | CLI tests execute top-level and scoped help and require clean user-facing errors; skills point only to supported discovery. | Permanent CLI usability gate. |
| Archived tasks retained App-managed worktrees | Archive visibility and worktree reclamation were incorrectly treated as one synchronous host event. | Tests assumed archival removed the worktree immediately. | Archive status records task visibility and worktree attachment separately and never replays an accepted archive call merely because reclamation lags. | Thin when public App lifecycle explicitly exposes reclamation state. |
| Loaded skill metadata pointed at an uninstalled release | Long-lived tasks can retain a stale skill catalog after plugin replacement. | Acceptance used a fresh task only. | Refresh authenticates the invoking skill against installed/runtime authority once and requests an App reload on stale catalog state; no recurring preflight. | Retain until the App guarantees live catalog refresh per task. |
| Coordinator received only a provisional task identity | Current App creation could return before the durable visible-task ID became public. | Canary did not include provisional-only return and catalog lag. | Executor start claim establishes exact ready identity; bounded mapping remains archival-only. Fixtures cover claim-before-result, result-before-claim, opaque results, duplicates, and contradictions. | Remove mapping capsule when public operation-bound resolution is reliable. |
| Long-lived coordinators accumulated incompatible predecessor state | Clean-start releases assumed short-lived coordinators and uniform fleet cutover. | Release acceptance did not use the same coordinator across versions or audit retained projects. | Immutable source runs plus one bounded semantic refresh handoff; integrated work stays in baseline, disposable assignments receive fresh identities. Unsupported older state unplugs explicitly. | v0.8 export retires after no supported v0.8 source runs remain. |
| v0.8 refresh assumptions failed only during v0.9 porting | Compatibility code assumed the current bundle kind and a removed branch-preflight helper. | Unit fixtures mocked current source shape rather than invoking the exact predecessor tag. | Exact-tag v0.8.3 refresh test validates the predecessor bundle and executes source CLI operations; source authentication is capsule-local. | Test leaves with the v0.8 refresh capsule. |
| Bootstrap-only executor spent minutes waiting | Identity and branch safety were serialized through a nonproductive first model turn plus a second coordinator message. | Safety tests measured correctness but not useful first-turn behavior or Flow-added latency. | Full assignment is the first prompt; executor start authenticates identity and binds the branch before useful work in that same turn. Canary records App provisioning time separately from Flow activation time and asserts one prompt/no release message. | Bootstrap and release modules are absent from v0.9 package authority. |

## Release discipline

The recurring pattern was not insufficient unit-test volume. We tested internal
transitions but underrepresented real host shapes, linked Git topology,
cross-version source authority, App turn boundaries, and full lifecycle joins.
The lean prevention is therefore:

1. keep pure core tests independent of App fixtures;
2. maintain small typed adapter fixtures for every observed host shape;
3. execute complete real-Git lifecycle tests, not only isolated transitions;
4. invoke the exact immediately preceding tag for compatibility tests;
5. require one live RC canary for App-facing changes; and
6. give every compatibility mechanism a named exit condition.

These gates prove protocol compatibility. They do not prove that orchestration
or a routing policy improves quality or cost; that remains a separate frozen,
held-out evaluation.
