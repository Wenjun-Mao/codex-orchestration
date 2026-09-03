# v0.8 refresh-contract coverage

This document maps the long-lived coordinator refresh boundary to focused
automated and live acceptance evidence. It is a coverage map, not a second
lifecycle specification; [ADR 0040](adr/0040-long-lived-coordinator-refresh.md)
and the `refresh` skill define the contract.

| Contract | Evidence required |
| --- | --- |
| A newly loaded skill and an active source run do not imply a hot switch | Package A routes only through its immutable snapshot; package B reports `resume-source` or `refresh-ready` after authenticated inspection. |
| One same-coordinator handoff | Exactly one locked `refresh-v1` handoff progresses `prepared → archive-observed → source-retired → consumed`; every interruption is resumable, including no-replacement clean-start consumption. |
| Wait preserves completed work | A source executor result is dispositioned, integrated, archived, and cleanup-clean before refresh; its work is present in the target baseline and is not reissued. |
| Discard removes only source-local unfinished work | An exact archived, unintegrated executor worktree and local branch may be dirty, ignored, untracked, or unmerged; removal is worktree first, then branch. |
| Replacements are independent | Reissued executor tasks have new task/contract/operation/branch/worktree/runtime identities and explicit fresh selectors plus a selector rationale. |
| Dependency coverage is exact | Target work includes each discarded assignment and only dependencies not represented by the post-integration baseline. |
| Compatibility stays bounded | Exact-tag v0.7.8 adapter cutover passes while a deliberately broken target validator proves that raw legacy records are read and validated only by the authenticated v0.7.8 bundle; successive v0.8+ sources parse their own records through an authenticated source exporter; malformed or unsupported predecessor state blocks and routes to `unplug`. |
| Whole-namespace deletion is complete | Every non-selected source run is independently closed and cleanup-complete; abandoned runs, pending callbacks, live worktrees, or local branches block deletion. |
| Safety gates remain closed | Stale receipt, late callback, remote/protected ref, prior integration, ambiguous task identity, archive disagreement, path drift, or snapshot tampering prevents apply or activation. |
| Non-goals remain absent | No `AGENTS.md` access, recurring preflight, general predecessor migration, daemon, registry, or silent fallback is introduced. |

## Live acceptance

The required same-coordinator canary passed on 2026-09-03. One RC1 executor
finished and was integrated at `ff02ae322e8198594706dfeaf5c948947bdbaf00`;
the other was archived and its unintegrated worktree and branch were discarded.
After an App reload, the same coordinator consumed refresh handoff
`refresh-v1-ce5dae4624f8cd25c1ef210a273df6de1ccfdecb939c6768349a8ae70acc90ec`
into an RC2 run and reissued only the discarded assignment to a freshly
selected Luna-medium executor. The replacement completed at
`304fe9c17fbd4fdebc89ab11c28bea82b10389cc`; the target run closed with a
terminal-ready audit and no canary task, worktree, branch, or handoff remained.

Independent post-canary review found that the initial apply request still
trusted caller-authored archive booleans. Stable v0.8.0 instead requires an
exact, digest-bound private App archived-session proof and re-observes its
session digest before deleting executor-local Git state. The corrected path is
covered by the full refresh crash-boundary test, public CLI invocation, schema
parity and forged/stale/foreign-proof negatives. A final read-only live check
authenticated all three archived canary sessions under Codex host CLI
`0.153.0-alpha.5`; the already completed destructive canary was not replayed.
