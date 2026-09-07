---
name: refresh
description: Route a long-lived Codex Flow coordinator to its pinned run or an authenticated package transition.
---

# Refresh a Coordinator

Run `refresh inspect --invoking-skill <this exact SKILL.md>` once before
actionable coordination:

- `fresh`: activate a new run.
- `resume-source`: continue through the source snapshot.
- `refresh-ready`: prepare the supported semantic handoff.
- `blocked`: resolve the named ambiguity.

A stale loaded skill requires App reload, not an attempt to hot-switch a run.
Unsupported predecessor state uses an explicitly approved unplug.

For each visible executor, choose **wait** to finish, integrate or verify
no-change, and archive under its source runtime; or **discard** exact
unintegrated executor-local work for semantic reissue. The latter is
preauthorized within the refresh contract, not permission to discard arbitrary
work. Active native subagents must finish or be disposed through their source
lifecycle.

An unfinished `execution_kind: coordinator` claim is also refresh-managed. It
must be discarded and reissued semantically with a fresh task and selector; it
has no child archive, worktree, or branch cleanup authority. A completed
coordinator claim remains embodied in the authenticated baseline and is not
reissued. Only a source with no unfinished refresh-managed work may take the
no-replacement clean-start path.

Use `refresh prepare`, archive the exact discard targets, and apply only with
authenticated archive/no-active evidence. Use `refresh observe-private` when
public indexing is insufficient. `run activate --refresh-id` consumes the
source-retired handoff. Preserve integrated results in the target baseline;
replacements receive fresh task, launch, Git, and selector identities.

Preserve assignment reporting through the authenticated transition. Do not
delete its authority with the source journals or adopt an unrelated installed
reporter. Resume persisted transitions without replaying ambiguous host calls.
