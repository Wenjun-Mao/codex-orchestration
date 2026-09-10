# Main consolidation and bounded cleanup

## Final disposition — explicit one-time cleanup approved

The user subsequently explicitly requested removal of all remaining non-main
branches and cleanup of finished coordinators, superseding the retention decision
below for these obsolete resources. This is administrative retirement, not a
claim that incomplete historical Flow runs completed successfully.

All ten remaining secondary worktree tips were verified as ancestors of main.
Nine exact task owners were read and had completed turns with no active work;
each was archived through the App. The one untracked audit note was compared
byte-for-byte with its preserved backup and moved into the same cleanup-evidence
directory. All ten secondary worktrees were removed using non-force Git removal,
including the detached stable source checkout; its artifact area was retained.
The previously archived ea5e checkout had already been reclaimed by the App.

The five remaining non-main local branches and final remote delivery branch
were deleted after their commits were preserved on main. Only main and its
primary checkout remain. Published tags, installed v0.9.12, other projects, and
the director task were untouched. Archived tasks can be restored; removed
checkouts and branch tips can be recreated from main's history or release tags.

Historical Flow journals were not rewritten or unplugged. They may still report
unresolved historical obligations referencing these administratively retired
resources. Do not interpret this cleanup as a successful protocol closeout or
automatically resume those old assignments.

## Prior bounded pass (superseded retention inventory)

The user requested merging completed work back to main and cleaning branches
and worktrees after a successful initial v0.9.12 project trial.

## Completed

- `19e1852` committed the approved test-only checks and preserved rollout reviews.
- `7d5dd1d` merged the current delivery and divergent director planning history
  into main and was pushed. The sole conflict was an older versus completed
  version of the same plan; the completed delivery text was retained, with both
  histories reachable through the merge. Executable paths remain identical to
  released `f61b39f`; no installed package or release tag changed.
- Four obsolete local branches were removed: v0.9.11 assignment consolidation,
  v0.9.11 lifecycle reliability, v0.9.7 skill pruning, and v092 role routing.
- Six merged remote branches were removed: v0.9.10 identity closeout, v0.9.11
  assignment consolidation, v0.9.11 lifecycle reliability, v0.9.7 assignment
  closeout, v0.9.7 skill pruning, and v0.9.8 large-history closeout. Their tips are
  preserved in main; published release tags remain intact.
- Pruned the one stale Git registration for the already-missing
  `/private/tmp/codex-orchestration-v091rc1-d9e2c93` checkout. No files were deleted.
- Archived completed source-only delivery task
  `01a0890b-dca3-7612-8834-7b9befdf5ae6` through the App. Its clean worktree remains;
  archival is not a claim of reclamation.
- Preserved the original untracked primary canary plan and audit-worktree note
  under `.git/codex-cleanup-evidence/2026-09-11-main-consolidation/`. Main already
  contains their later versions; no original bytes were discarded. The original
  audit note also remains in its worktree.

## Retained, not declared cleaned

`codex/v0.9.10-stable-coordinator` at `21096a7` and
`codex/v0.9.10-identity-closeout` at `6aac952` were restored after the initial
merged-branch sweep: historical lifecycle bindings still reference these names.
Reachability alone is not permission to remove unresolved lifecycle resources.

- `abca`: terminal-refresh-classification checkout; assignment
  `coordinator-assignment-v1-1025c8301e8253334114f1f94d9c0fa98fb14681d83eb14755611f80853b5366`
  is still open with an active route. Its historical registered branch differs
  from the current checkout branch. Requires explicit supported disposition,
  not ordinary Git deletion.
- `435e`: completed audit task with an untracked original note (preserved above).
- `7fe0`: old v0.9.9 delivery checkout; retained pending lifecycle reconciliation.
- `43fe`, `51d5`, `5dab`, `bf06`, `d169`: older reporting canary checkouts;
  task turns ended, but that alone does not retire their experimental run state.
- `f43c`: old RC13 canary checkout; retained pending ownership/closeout review.
- `ea5e`: current delivery task archived, clean commit `19e1852` preserved in
  main; App did not immediately reclaim its checkout. It used the approved
  source-only exception and has no modern assignment closeout to invent.
- `/Users/wjmao/projects/utility_projects/codex-flow-v0.9.12-stable-f61b39f/source`:
  detached release-evidence checkout, retained as part of the stable artifact area.

The cleanup skill prohibits independent manual removal of pending task worktrees.
No force removal, lifecycle edits, namespace retirement, or archive replay was
used. Further reclamation must resolve these exact owners/obligations or receive
an explicit bounded exception; do not widen this into a release repair campaign.
