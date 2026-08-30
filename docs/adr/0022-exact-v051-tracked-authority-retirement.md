# ADR 0022: Exact v0.5.1 tracked-authority retirement

## Status

Accepted for the v0.6 development boundary.

## Context

Progressive v0.6 activation is setup-free only when a repository has no tracked
predecessor authority. Accepted v0.5.1 repositories carry a manifest-owned
runtime, project configuration, and either a managed AGENTS block or an
externally attested instruction file. They may also retain task, callback,
urgent, Git, and audit records under `.git/codex-flow/v0.5.1/`.

The v0.6 historical verifier initially reused the current package's Git state
namespace. It therefore reported an empty v0.6 namespace instead of the real
v0.5.1 records. Reusing v0.6 adoption retirement would also be unsafe because
that manifest does not own the v0.5.1 paths or AGENTS boundary.

## Decision

- `adopt legacy-retire-plan|legacy-retire-apply` is a distinct, run-independent
  contract for accepted tracked v0.5.1 only.
- The plan authenticates the exact repository, Git baseline, predecessor
  manifest/configuration, managed AGENTS block, and raw Git-common evidence
  tree. Every tracked change has explicit before/after hashes.
- Managed mode removes only the exact marked AGENTS block. External mode never
  edits the attested external file. When the managed block is the whole file,
  the resulting empty file is retained because v0.5.1 did not persist proof
  that it owned the file itself.
- Planning reports all blockers. Apply requires an unchanged applicable plan,
  rechecks the full tracked and evidence state, rolls back partial filesystem
  changes, makes no commit, and supports exact already-applied replay.
- Unresolved or ambiguous creation, pending or invalid callback authority,
  pending urgent work, leases, and unbound host worktrees block retirement.
  A consumed terminal result or valid acknowledged supersession chain settles
  an observed executor. Retained branches and worktrees are reported but are
  not removed.
- The v0.5.1 tag, installed cache, Git-common evidence, tasks, branches,
  worktrees, and unrelated bytes remain untouched. No v0.5 operational record
  is imported into v0.6.
- `legacy-v05` read-only verification binds package and state authority
  explicitly to v0.5.1. Predecessor mutation remains permanently disabled.
- Successful retirement leaves a predecessor-free repository eligible for
  setup-free v0.6 activation. It does not create tracked v0.6 adoption.

## Rejected alternatives

- Ignore tracked v0.5.1 during activation. This permits two instruction/runtime
  authorities in one repository.
- Delete the whole AGENTS file when only the managed block remains. The prior
  installation does not prove whole-file ownership.
- Require Git branch/worktree cleanup before retirement. Those resources are
  preserved evidence and may remain independently useful.
- Migrate or summarize v0.5 records into v0.6. Breaking-version isolation is
  clearer and keeps the accepted predecessor independently auditable.
- Load the installed v0.5.1 cache to inspect history. Historical verification
  must remain package-local, deterministic, and read-only.

## Consequences

The transition has two explicit approvals: implementation of the capability,
then review and application of a repository-specific plan. Applying a plan
produces ordinary uncommitted tracked changes; committing or integrating them
is a separate repository decision. Other predecessor versions remain blocked
until they receive their own authenticated contract.
