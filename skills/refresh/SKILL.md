---
name: refresh
description: Refresh one long-lived Codex Flow coordinator onto the currently loaded plugin release through a bounded wait/discard handoff. Use before actionable coordination when repository state belongs to a different supported release; never hot-switch an active run.
---

# Refresh a long-lived coordinator

Use this skill only from the installed Codex Orchestration package that the App
has actually loaded. Resolve this skill's own directory, then invoke the sibling
package CLI with the exact absolute path to this `SKILL.md` as
`--invoking-skill`. The CLI authenticates that association and the skill digest.
If the loaded catalog path, package version, and CLI disagree, stop and ask for
an App skill reload or restart. Do not search another cache version or claim the
plugin can hot-reload itself.

## Route once before actionable coordination

Run `refresh inspect --invoking-skill <this-SKILL.md> --json` once when the user
asks for actionable orchestration. Follow exactly one route:

- `fresh`: use `codex-orchestration:coordinate` and the loaded package for a
  fresh run.
- `resume-source`: continue the active run only through the immutable runtime
  snapshot named by the inspection. Never send a source-run mutation through
  the newly loaded package. The sole exception is the v0.8.2 read-only evidence
  adapter below; its output is still consumed only by the v0.8.1 snapshot.
- `refresh-ready`: choose wait or discard for each source executor task, then
  perform the bounded handoff below.
- `blocked`: report the exact authority, identity, archive, Git, snapshot, or
  App-reload blocker. Do not migrate, normalize, or silently fall back.

Installing a package alone never interrupts a task. Refresh begins only when
this loaded skill is invoked for actionable work in the same coordinator task.

## Recover one exact v0.8.1 private task identity

v0.8.2 contains one narrow recovery adapter for an active v0.8.1 operation
whose private task-ID resolver rejected a valid long-lived coordinator session
as too large. Use it only when inspection authenticates exact v0.8.1 source
authority and that source retains the same provisional operation or its exact
`reconciliation-window-expired` ambiguity.

Run `recovery v0.8.1 resolve-private --run-id <source-run> --operation-id
<source-operation> --out <absolute-temp-json> --json` from the same coordinator
task. The output path must be outside the repository. The command authenticates
the v0.8.1 runtime exporter and App evidence, writes only the unwrapped
reconcile request, and does not mutate App or Flow state. Submit that file
unchanged to `task create reconcile` through the exact source snapshot CLI
reported by source authority. Continue binding and release through that same
snapshot. Never run target-package reconciliation, infer a task ID, retry
creation, or treat this adapter as a general predecessor reader.

## Choose wait or discard

The coordinator may make this operational choice without another user prompt:

- **Wait** lets an executor finish under the source snapshot. Authenticate and
  integrate or disposition it normally before preparing refresh. This delays
  cutover and preserves its finished result in the repository baseline. Its
  ordinary archive and cleanup must also be complete: no executor worktree or
  local branch may remain. Refresh never uses discard authority to clean a
  waited executor.
- **Discard** applies to any not-yet-integrated executor assignment. Record a
  concise rationale, archive the exact visible task through the App, and let
  refresh remove only its authenticated local worktree and local branch. Dirty,
  ignored, untracked, unmerged work may be destroyed because it is explicitly
  unintegrated executor-local work. Discard authority ends as soon as any
  integration record exists.

Active native subagents must finish and be accepted or rejected through their
existing read-only lifecycle. They never enter the worktree discard path.
Provisional or ambiguous task identity, archive disagreement, another
repository, coordinator/source/protected branches, remote refs, attachment
drift, and missing evidence remain fail-closed.

## Prepare one semantic handoff

After every wait choice is durably settled, build a revision-one target workflow
for only discarded work plus dependencies whose results are not embodied in the
post-integration baseline. Every replacement uses a fresh task ID and a fresh,
deliberate model, reasoning effort, selector rationale, and where applicable
bounded `fork_turns`; its semantic execution surface is preserved. Never inherit
selectors from the source.

If no work requires replacement, pass `target_workflow: null`, an empty
replacement mapping, and empty target fences. This is a `no-replacements`
handoff and must not create a target run merely to finish refresh.

Pass one `refresh prepare` request containing:

- exact source namespace, run ID, and current resume fence;
- one `wait` or `discard` decision and rationale for every current visible
  executor task;
- an exact source-task to fresh-target-task mapping for the required closure;
- the target workflow and reservation fences for replacement work, or
  `null`/empty target authority for `no-replacements`, plus the same coordinator
  task ID.

The command persists one content-addressed `.git/codex-flow/refresh-v1/`
handoff before any deletion. Its replacement briefs preserve title, execution
surface, ownership, resources, primary outcome, causal question, cheapest safe
direct attempt, instrumentation role, and dependency topology. They exclude
old run/operation/Git authority and old selectors.

## Archive, apply, and activate

Archive every discarded visible task exactly once through the App. Then run
`refresh observe-private --refresh-id <exact> --invoking-skill
<this-SKILL.md> --json`. This read-only command authenticates the exact archived
App session, proves the task is absent from active sessions, and binds the proof
to the refresh, stable handoff authority, archive intent, task, and host. Pass
its exactly covering `archive_evidence` to `refresh apply` with the current
`refresh_id` and current handoff digest. Caller-authored archive booleans are not
authority.

Apply is crash-resumable. It revalidates evidence under the repository-wide
lock, removes each exact worktree before its local branch, invokes the source
run's authenticated snapshot to retire that source, and reaches
`source-retired`. It never touches remote or external side effects. Use
`refresh status` after interruption; do not replay an App archive call merely
because local cleanup was interrupted. If status is already
`archive-observed`, `refresh observe-private` rechecks the live archived session
and returns the exact persisted proof required to resume apply.

For a `replacement-run` handoff, finally call
`run activate --refresh-id <exact>` with the prepared target workflow, fences,
clean post-integration baseline, a fresh lineage ID, and generation 1 in the
same coordinator task. Activation consumes the handoff, records only minimal
source/replacement digests in the new run, removes the old namespace last, and
fences all old callbacks to their old run and generation. Only after activation
succeeds may the replacement executor tasks be created.

For a `no-replacements` handoff, do not activate a run. Resume `refresh apply`
with the current digest until it records clean-start consumption and removes
the source namespace and handoff. The next actionable invocation then routes
`fresh` and may create a new run only if new work actually exists.

The exact v0.7.8 adapter remains the only general predecessor cutover
adapter in v0.8. The v0.8.2 private-resolution adapter above is a read-only,
exact-v0.8.1 evidence bridge for one stranded operation shape; it neither
migrates journals nor mutates source state. Raw legacy refresh records remain
validated only through modules from the authenticated source runtime bundle;
target v0.8 validators are not general legacy authority.
Unsupported or malformed older state uses `codex-orchestration:unplug`; it is
never migrated by refresh. Do not add recurring preflights, daemons, registries,
retry loops, or `AGENTS.md` authority.
