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

Before stable release, one live same-coordinator canary must use two visible
executor tasks: accept one finished result, archive and discard the other,
reload the App to a next RC without replacing the coordinator task, reissue
only the discarded assignment with explicit fresh selectors, and prove the old
task/worktree/branch/handoff are absent after the replacement completes.
