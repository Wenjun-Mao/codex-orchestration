# Serial architecture options — independent consultation

Status: Decision inquiry, not authorization to implement or create another plugin.

## Decision and context

Choose between adapting Codex Flow and a separately developed serial-only
successor (provisionally called "lite"). A successor need not be a permanent
second edition or a from-scratch rewrite. Consider selective reuse and a bounded
retirement path for the old product. Neither option is preferred by this brief.

The user estimates 98% of work is sequential. Desired outcome: one retained
checkout, cheap sequential delegation when useful, verified results, reliable
reporting, task-only archival and useful successor admission. Preserve failures
honestly. Minimize concepts, cross-stage obligations, repeated recovery, restarts
and maintenance, not just LOC. Read-only reviews may run concurrently. Native
subagents are not an undocumented alternative writing surface.

The current plugin has repeatedly encountered integration/cleanup/upgrade
boundary problems. Existing v0.9.13 serves active projects, including Plotloom;
do not disrupt them. The preserve-and-reset proposal is paused. Runtime serial
implementation has not begun.

## Evidence boundary

Repository: https://github.com/Wenjun-Mao/codex-orchestration

Use the immutable documentation checkpoint supplied in the handoff prompt.
Runtime baseline is v0.9.13, commit
`a0e786cf69f3a671879ebe87fbec404b1dbbea00`; subsequent changes are documentation.
State the full commit inspected and distinguish proposed from implemented code.

Read:
- [Current serial plan](2026-09-11-serial-first-delivery.md).
- [Native feasibility observations](../field-tests/2026-09-11-serial-native-feasibility.md).
- [Paused recovery plan](2026-09-11-preserve-and-reset-recovery.md), only for boundaries.
- Relevant source, schemas and tests behind launch, coordinator work, dispositions,
  committed-write scope, assignment/iteration authority, historical settlement,
  report hooks/locators, and plugin packaging.

Access is GitHub-only. Local task sessions, private pilot source, native App
services and probe Git objects are unavailable. The published probe is an
operator-recorded observation, not something consultants executed independently.
If exact source is inaccessible, disclose that and limit conclusions accordingly.

Native result: three distinct local tasks used the same primary checkout/main.
C committed, E followed and messaged C, C continued after E archival, and C2
continued after C archival. Each task archived once without observed checkout,
branch or sentinel loss. No extra branch/worktree, Flow route, install or restart.
This supports host feasibility for that session only. It proves neither Flow
ownership nor hook compatibility between two installed plugins, interrupted
handoff safety, direct-result acceptance, or future host reclamation behavior.

## Common comparison contract

Evaluate the same useful journey under both options: coordinator checkpoint →
serial executor write → exact result verification → coordinator continuation →
report/acceptance → task-only archival → useful new assignment. Include rejected
or dirty work, a stale resumed writer, and an interrupted handoff. Failed shared
commits already occupy the branch; acceptance is not isolation.

Compare required concepts and records, irreversible actions, retained failure
obligations, reused components and their transitive coupling, implementation
uncertainty, test burden, operations and eventual maintenance. Give relative
effort with assumptions rather than invented precise schedules or numerical scores.
What evidence would reverse your conclusion? Do not assume a fresh repository
eliminates hard identity, reporting, concurrency or recovery requirements.

Working constraints: no automatic reset/stash/commit, live journal migration,
global writer-lock service, daemon, new report bus or generic execution framework
by default. No package update, hook or shared-setting mutation, pilot reset or
implementation is authorized. A different package name alone does not establish
coexistence safety. Flow cannot physically fence arbitrary editor/shell writes.

## Three independent roles

### A — Adaptation case

Make the strongest code-grounded case for evolving the existing plugin, but
recommend a successor if adaptation is worse. Provide a keep/remove/change map,
minimal public-contract changes and actual reduction of serial-path obligations.
Distinguish retained-coordinator slice from full serial delegation. Identify
where supporting isolated history makes simplification disproportionately hard.
Do not propose indefinite foundation releases or a serial wrapper around fake
integration and cleanup.

### B — Serial-only successor case

Design the smallest credible successor and defend every durable concept. Map
proven components to reuse unchanged, extract with bounded changes, or omit;
inspect dependencies rather than calling an entire module reusable by name.
Prefer a potential successor, not two permanent editions. Define the normal
journey and truthful blocked/recovery boundaries without rebuilding current Flow
under shorter names. Recommend adaptation if the new product does not earn its
development and maintenance cost. Parallel writing is not required initially.

### C — Coexistence and transition adversary

Independently assess operational feasibility of BOTH options while old projects
continue. Inspect hook activation/discovery, locator and metadata namespaces,
global/package settings, ownership across old/new writers, archive behavior,
dependency packaging and pinned runtimes. Distinguish coexistence in different
repositories from both managing one repository. Propose the minimum isolation,
cutover and rollback boundaries, including source preservation without live
journal translation. Name local host checks GitHub cannot settle. No full
architecture proposal unless a concrete interference path requires one.

## Requested reports

Answer first with recommendation and conditions, then source-backed evidence,
minimum design/change map for your role, relevant failure boundaries, principal
tradeoffs and cheapest discriminating checks. Separate facts, operator reports,
inferences and unexecuted hypotheses. Cite exact files/functions at the inspected
revision. Separate blockers from optional improvements and name what NOT to build.
Do not infer acceptance from reviewer agreement. No implementation is requested.

Returned reports will be preserved unchanged; synthesis will classify insights
as Use/Test/Park/Discard and verify only claims relied on for the decision. The
comparison is not a vote: one decisive coupling or interference finding may
outweigh two preferences. A fourth general audit is not planned.
