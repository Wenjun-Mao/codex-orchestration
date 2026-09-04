---
name: refresh
description: Refresh one long-lived Codex Flow coordinator from an authenticated v0.8 source run to the loaded v0.9 release through one bounded wait/discard handoff.
---

# Refresh a Long-Lived Coordinator

Route once before actionable coordination with `refresh inspect
--invoking-skill <this exact SKILL.md>`. The routes are:

- `fresh`: start a new run with the loaded plugin;
- `resume-source`: continue the active run through its immutable snapshot;
- `refresh-ready`: prepare the bounded handoff;
- `blocked`: stop and resolve the named ambiguity.

The App owns skill reload. A stale loaded skill fails clearly and requires an
App reload; the plugin never claims to hot-reload itself.

For every visible executor choose:

- **Wait** when its result is already integrated or verified no-change and the
  task is archived under the source snapshot.
- **Discard** when its exact unintegrated executor-local work may be archived,
  removed, and semantically reissued. This is preauthorized by the refresh
  contract; do not ask again.

`refresh prepare` persists one content-addressed handoff with source/target
runtime identities, baseline, coordinator, semantic briefs, dependency
topology, and exact task/archive/worktree/branch evidence. Replacement tasks
receive fresh task, launch, Git, selector, and rationale identities. Integrated
results remain embodied in the target baseline.

Archive each discarded task through the App, then use `refresh
observe-private` only when public archive indexing is insufficient. `refresh
apply` revalidates evidence before removing the exact executor worktree, then
local branch, then retiring the source run. `run activate --refresh-id` consumes
the source-retired handoff atomically. Every transition is resumable.

v0.9 accepts only the authenticated v0.8 semantic refresh export. There is no
migration: it does not parse or reinterpret v0.8 journals. Unsupported older
state uses explicit unplug.
Do not add recurring preflights, retries, daemons, registries, or silent
fallback.
