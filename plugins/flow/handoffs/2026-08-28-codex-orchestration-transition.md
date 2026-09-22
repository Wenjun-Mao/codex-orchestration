# Codex Orchestration project transition

Date: 2026-08-28

Purpose: one-time handoff from the long-running UK Dev coordination task into a
new task rooted directly at this repository. This document is project memory,
not a plugin instruction, runtime contract, or substitute for the ADRs and
skills. It is intentionally outside `package.json`'s packaged file list.

## Resume checklist

Before changing anything:

1. Authenticate this repository, current branch, exact revision, cleanliness,
   remotes, and installed plugin version.
2. Read `README.md`, `docs/coverage-v0.5.1.md`, ADRs 0007 through 0014, and the
   two latest field-test records named below.
3. Preserve the accepted v0.5.1 package and private plugin installation until a
   newly scoped checkpoint is agreed.
4. Do not mutate UK Dev, its Cocos plugins, or its active tasks from this
   repository without an explicit cross-project handoff.

## Current source authority

- Repository: `/Users/wjmao/projects/utility_projects/codex-orchestration`
- Current branch: `main`
- Accepted source tip:
  `d03cabfffb612ad8f33853896b15deee3ad66698`
- Runtime correction exercised by the final held-out pilot:
  `b3d933a4b895dfee26fd142eb994f338456f5591`
- Accepted package, plugin, and pinned consumer runtime version: `0.5.1`
- Editable source development identity after the post-release baseline:
  `0.5.2-dev.0`
- Worktree was clean before this handoff was added and after the final Git
  cleanup.
- Canonical public remote:
  `https://github.com/Wenjun-Mao/codex-orchestration.git`
- Local `main` tracks `origin/main`. Release tag `v0.5.1` identifies the exact
  accepted source tip above; later handoff and governance commits are not part
  of that accepted package.
### Historical acceptance topology

At the final 2026-08-28 cleanup, local `main` had been fast-forwarded through
the accepted source and handoff-only commits. That historical checkout then had
one local branch and one registered worktree. Eleven merged historical
`codex/*` branches were deleted only after Git proved each was an ancestor of
the handoff tip; no unmerged or remote branches or stale worktree registrations
were found. The disposable
`/Users/wjmao/projects/utility_projects/codex-flow-v05-heldout` fixture root
was also absent. This is acceptance evidence, not a claim about any later
executor branch or worktree; authenticate current Git state before cleanup.

The handoff-only commits at acceptance changed no packaged path. Accepted
v0.5.1 package bytes remain exactly those at `d03cabf`. ADR 0014 records the
later discovered source-validation gap and establishes the `0.5.2-dev.0`
development identity; no later source change may be repackaged or installed
under the accepted v0.5.1 version.

## Private distribution state

- Personal marketplace source:
  `/Users/wjmao/plugins/codex-orchestration`
- Installed plugin cache:
  `/Users/wjmao/.codex/plugins/cache/personal/codex-orchestration/0.5.1`
- Personal marketplace manifest:
  `/Users/wjmao/.agents/plugins/marketplace.json`
- Plugin identity: `codex-orchestration@personal`

At acceptance, the marketplace source and installed cache were byte-identical
validated package artifacts. They are generated distribution copies, not the
editing authority. Make changes only in this repository, validate and package
them, then refresh the marketplace source and installed cache through the
plugin update workflow.

Because v0.5.1 is accepted, do not silently replace its behavior under the
same version. The editable source now uses the unreleased `0.5.2-dev.0`
identity and, if explicitly installed, its exact-release state namespace is
`.git/codex-flow/v0.5.2-dev.0/`. Marketplace and UK Dev adoption remain
separate explicit decisions. The active repository-pinned runtime remains
v0.5.1 and retains `.git/codex-flow/v0.5.1/` unless explicit retirement and
fresh installation occur.

## Product intent

Codex Flow is a private, repository-portable orchestration package with two
deliberately separate layers:

1. A Codex plugin and progressively disclosed skills teach setup,
   coordination, execution, integration, and cleanup.
2. A dependency-free Node `.mjs` CLI enforces task packets, journals, Git
   ownership, leases, deterministic plans, and cleanup.

It must remain useful in Python and other non-JavaScript repositories. Node.js
20.11+ and Git are the only runtime requirements. It is not a daemon, MCP
server, hook, background service, or secretary task.

The user strongly prefers a light design. If a correction starts requiring
heavy infrastructure, dual execution paths, compatibility readers, or many
new states, step back and reconsider the contract. While the package remains
private and pre-stable, prefer a clean breaking change over backward
compatibility and technical debt.

## Stable workflow contracts

### Setup and distribution

- Plugin-first setup replaced copy-paste onboarding in v0.5.
- Natural requests such as "Set up Codex Flow here" and explicit
  `$codex-orchestration:setup` load the setup skill.
- Skill discovery is not mutation authority; setup intent must be explicit.
- New repositories use a dedicated bootstrap branch. Existing dirty
  repositories use a clean linked adoption worktree and preserve ongoing work.
- Planning is read-only and branch-bound. Apply accepts only the exact unchanged
  plan, then repository validators and `doctor` must pass.
- Managed AGENTS integration is the default. External AGENTS mode requires an
  explicitly reviewed equivalent contract and hash attestation.
- A different installed Codex Flow version requires explicit retirement and
  fresh installation. There is no upgrade compatibility path.

### Coordinator and executor roles

- The coordinator owns the DAG, task creation, shared-resource leases,
  callbacks, integration, reproof, cleanup, and archival.
- An executor owns only its packet and local branch. It does not manage
  siblings, monitors, the coordinator, or archive state.
- Visible task threads and hidden subagents are distinct requested kinds and
  fail closed if the host cannot create the requested kind.
- Default all new task threads and subagents to `gpt-5.6-terra` with `xhigh`
  reasoning unless the user explicitly chooses otherwise.
- Visible project work should be created in the same saved Codex App project by
  default. Cross-project and projectless placement are explicit exceptions.
- Archive completed visible tasks only after their result, callback
  disposition, integration evidence, and owned Git/worktree cleanup are
  preserved. Keep blocked or attention-needed tasks visible.

### Parallel work

- Validate source revision, exact path ownership, exclusions, dependencies,
  serial gates, exclusive resources, stop rules, and cleanup owner before
  fan-out.
- Parallelize path-disjoint tasks when useful. Keep shared interactive apps or
  other exclusive resources serial and leased.
- The task packet records role, visible task versus subagent kind, title,
  model/reasoning, source revision, owned paths, exclusions, dependencies,
  exclusive resources, stop rules, callback recipient, integration gate, and
  cleanup owner.

### Completion and urgent communication

- Ordinary completion is `journal-monitor` authoritative. Executors persist a
  strict terminal receipt; they do not enqueue a full callback into the Codex
  thread queue.
- The coordinator should inspect callback status without observing the receipt
  until independent review determines its integration or rejection path.
- Observation is immutable. A corrected result after observation uses a fresh
  operation and `run_id` rather than overwriting the checkpoint.
- Urgent blockers, approvals, and high-risk drift use the separate journaled
  direct-signal path with stable urgent identity and delivery-attempt identity.
- Strict receipt allowlists reject secrets, raw identifiers, logs/transcripts,
  user data, unknown fields, oversized text, and nonexact accounting keys.

### Waiting and liveness

- Prefer bounded Codex App `wait_threads` while the coordinator turn is active.
- Carry returned cursors into later waits to suppress repeated final text.
- A wake, timeout, interruption, or task final message is only liveness; return
  to the repository callback journal before integration.
- The journal remains the durable source across restart, compaction, resume, or
  an ended coordinator turn.

### Git lifecycle and cleanup

- Host-created worktree tasks use two phases: create with a no-action bootstrap,
  observe and authenticate the actual worktree, bind/claim the declared branch,
  then release the real packet.
- Persist exact worktree path, local branch, upstream, revision, and integration
  disposition.
- Cleanup is coordinator-only and audit-first. Generate an exact deterministic
  plan, prove protected branches, active operations, leases, clean worktrees,
  fetched remote tips, and pushed integration, then apply that unchanged plan.
- Dirty, active, ambiguous, drifted, or uniquely unmerged state is preserved.
- Partial cleanup invalidates its old plan. Read the structured completed
  actions, run a fresh audit, and make a new plan for what remains.

## v0.5.1 accepted boundary

v0.5.1 fixed two related host lifecycle gaps:

1. Task operations now persist same-project, cross-project, projectless, or
   inherited placement intent and distinguish independently observed placement
   from a target merely accepted by the create call.
2. An observed bootstrap rejected before release can reach a durable terminal
   state after archive and exact absent-worktree proof. Interrupted preownership
   branch claims can be settled only under strict exact-baseline, no-checkout,
   no-fetched-remote evidence.

The first repilot exposed one additional root cause: v0.5.1 reused
`.git/codex-flow/v0.5`, so it parsed retained v0.5.0 task records whose schema
predated `observation_policy`. The durable breaking correction derives the
state namespace from the exact package version. The accepted v0.5.1 runtime's
mutable state is `.git/codex-flow/v0.5.1`; retained v0.5 and v0.4 evidence is
untouched, unread, and unmigrated.

Final source verification passed:

- complete dependency-free Node suite: 102/102
- `npm run validate`
- `npm run pack:check` (90 packaged files after acceptance evidence)
- plugin validation
- setup and coordinate skill validation
- `git diff --check`

The final UK Dev held-out replay passed same-project Terra/xhigh creation,
bootstrap, branch bind, release, one bounded executor change, journal callback,
serial integration/reproof, duplicate-safe consume, deterministic local/remote
cleanup, and task archival. Retained `.git/codex-flow/v0.5` remained
byte-identical. See:

- `docs/field-tests/2026-08-27-plugin-first-setup-v0.5.md`
- `docs/field-tests/2026-08-28-uk-dev-v0.5.1-exact-state-replay.md`
- `docs/adr/0010-plugin-first-package-authority.md`
- `docs/adr/0011-host-project-placement-and-pre-release-rejection.md`

## Known Codex host behavior

Treat these as field evidence, not public API guarantees:

- A visible host-worktree task may initially return only a setup
  `clientThreadId`; one bounded recent-list/read can recover the task and path.
- Desktop creates selected worktrees detached. Codex Flow validates the path,
  common Git directory, cleanliness, and baseline before atomically claiming
  the packet-declared branch.
- Desktop may replace the requested title with bootstrap or delegation text.
  Use one bounded title normalization and exact reread before reconciliation.
- Current list/read surfaces can omit project, model, and reasoning. Exact
  create-call acceptance is retained as partial `host-accepted` evidence and
  must not be described as independently observed. Any contradictory non-null
  project placement fails closed.
- `list_threads` has historically advertised a `query` field that the live host
  rejected. Bounded unfiltered listing plus exact read is the fallback.
- Terra/xhigh task creation previously had transient serialization failures that
  disappeared after a Desktop restart. Do not classify Terra as permanently
  unsupported from that failure alone; reconcile before retrying.

## Ownership boundary with UK Dev

The original coordination task remains `TikTok mini games - consultant`, thread
`01a01d27-4238-7313-b0bc-5569c058822c`. This transition task is
`codex-orchestration`, thread
`01a02ff3-8774-7e00-87c1-6e4873232fcf`.

Codex Orchestration owns generic task/subagent lifecycle, callbacks, task
packets and DAGs, leases, cleanup/archive policy, and portable repository
bootstrap. UK Dev retains Cocos-specific plugin rules, Yindian/Nanrennixi
product work, and the Cocos Dashboard/Creator broker.

Coordinate before changing shared UK Dev assets, especially root `AGENTS.md`,
`.codex/agents`, ADR 0027, `scripts/codex-process`, either Cocos plugin, or the
Dashboard broker. Findings from UK Dev should arrive as identified handoffs and
be discussed here before generic implementation.

UK Dev `main` has not adopted v0.5.1. The successful disposable adoption pilot
was deliberately left unmerged for a separate user decision. Do not infer that
active pre-v0.5 tasks should be migrated.

## Pilot-user model

This repository is the sole authority for generic Codex Flow behavior.
`TikTok mini games - consultant` is the primary reference pilot: it supplies a
demanding real-world UK Dev workload and regularly tests candidate releases,
but it is a consumer rather than a co-owner of the package.

Use unrelated Python, utility, research, and other repositories as held-out
users. Together, package fixtures, the reference pilot, and unrelated users
form three validation rings. A lesson observed only in UK Dev is a candidate
guardrail, not automatically a generic contract; review its transferability or
confirm it with an unrelated fixture or user before broadening the package.

Consumer projects must not patch generic Codex Flow locally. They should send
identified field findings containing the exact package revision, pinned
runtime, observed behavior, evidence boundary, absence or presence of a local
workaround, and smallest requested generic decision. The package-owner task
discusses and implements accepted generic corrections, then returns a new exact
authority for another pilot. Adoption remains explicit per consumer; a pilot
PASS does not automatically replace active runtimes elsewhere.

## Resolved transition decisions

1. **Source visibility and release protection.** The public GitHub remote is
   the canonical shared history, while the personal marketplace remains the
   supported private distribution channel. Immutable annotated release tags
   bind exact accepted source tips. ADR 0012 records the full decision.
2. **Self-hosting.** The user chose this source repository as a first-party
   consumer. ADR 0013 requires adoption through the exact installed plugin,
   stable project ID `codex-orchestration`, managed instructions, and a clean
   dedicated adoption worktree. Editable source remains distinct from the
   pinned consumer runtime.
3. **Workflow record.** ADRs 0007 through 0014 are the durable workflow and
   release-contract record. This handoff summarizes their transition context;
   it does not supersede them.

## Open decisions and useful next work

1. **wait_threads multi-wave field proof.** v0.4.3 guidance is source-tested,
   and later single-task pilots used the waiter, but a natural path-disjoint
   multi-task wave has not yet provided the intended held-out proof. Use the
   next genuine parallel wave rather than manufacturing work.
2. **UK Dev adoption.** v0.5.1 is suitable for newly launched UK Dev executors,
   but merging its disposable pilot or updating UK Dev `main` is a separate
   explicit choice owned with the consultant task.
3. **Future versioning.** Keep exact-release state isolation and the breaking
   pre-stable policy. Revisit migration/compatibility only if the user later
   declares a stable supported compatibility boundary.

## Verification commands

Run from this repository:

```bash
npm test
npm run validate
npm run pack:check
git diff --check
python3 /Users/wjmao/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
python3 /Users/wjmao/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/setup
python3 /Users/wjmao/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/coordinate
```

For distribution updates, validate an `npm pack` artifact, refresh the personal
marketplace source from that artifact, run
`codex plugin add codex-orchestration@personal`, and prove the installed cache
is byte-identical to the marketplace artifact. Do not hand-edit marketplace
configuration or treat the generated cache as source.
