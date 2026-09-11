You are independently reviewing a proposed recovery workflow for Codex Flow, a personal Codex orchestration plugin. You have no prior conversation context. This is a plan review, not implementation or release acceptance.

## Evidence and access

Repository: https://github.com/Wenjun-Mao/codex-orchestration
Source baseline: a0e786cf69f3a671879ebe87fbec404b1dbbea00 (published v0.9.13).
Plan: docs/plans/2026-09-11-preserve-and-reset-recovery.md, in the published documentation checkpoint supplied with this prompt. Read that checkpoint's plan and source; state the actual full commit inspected. The documentation checkpoint does not change runtime source.

Your access is GitHub-only. You cannot inspect our local files, task histories, host services, backups, or private pilot repositories. If exact source is inaccessible, disclose that limitation; do not silently substitute another revision or claim source verification. No external research is necessary unless a specific claim requires it.

Useful starting points (follow dependencies as needed):
- skills/unplug/SKILL.md and skills/direct/SKILL.md
- lib/compat/unplug.mjs: planning, exact digest validation, private archive observation, apply
- lib/run-lifecycle.mjs: abandonRun
- lib/assignment-acceptance.mjs: cancelAssignmentResult
- lib/compat/refresh.mjs
- test/unplug-v09.test.mjs and test/assignment-lifecycle-v097.test.mjs

## Why we are considering this

Our earlier development suffered repeated recovery loops, lifecycle boundary mismatches, and expensive validation/restarts. We want less coordination and fewer mechanisms, not an elaborate universal recovery framework.

Operator-reported incident facts below are context, not independently inspectable runtime evidence:
A pilot coordinator committed two intended files outside its declared write scope. Flow correctly rejected completion and retained a started claim. Fresh work was then blocked by the old authority. Recovery ultimately succeeded through external verified backups, owner abandonment, director cancellation after pending reports settled, a new exact unplug plan and explicitly approved metadata-only apply, followed by fresh preparation. Product source, refs, existing tasks and worktrees were retained. This proves an existing recovery sequence, not automatic archival, interruption safety, or a convenient unified interface.

The user asks why the director cannot simply preserve useful work, archive obsolete workers, remove project-local Flow state, and start fresh. The proposed plan composes existing machinery. Reset must not falsely certify failed work as completed or accepted.

A later alleged missing host-identity issue was disproved by an exact environment check; it was an incorrect diagnostic filter, not another plugin defect. Do not use it as justification for new recovery machinery.

## Constraints

- Challenge the premise and the plan. No new runtime mechanism is a valid recommendation.
- Preserve committed and uncommitted useful work; Git bundles alone omit working-tree files. Private backups must not be published.
- Archival and worktree deletion are distinct, but host archival may reclaim a worktree. Do not assume host behavior that repository code cannot prove.
- No automatic reset on failure, cross-host recovery, global uninstall, dashboard, daemon, generic framework, fake package bump, historical evidence rewriting, or pilot mutation.
- Do not expand this into live scope amendment or new claim states. Earlier scope checks are a separate follow-up.
- A local deterministic CLI regression and owning-host live proof have different evidentiary roles.
- We want practical reduction in user steps, tokens, and recovery time without weakening preservation or authorization.

## Your distinct role: simplicity and minimal implementation

Determine whether the proposed workflow needs runtime code, or whether a concise skill/playbook over existing commands is sufficient. Compare:
1. Existing commands plus a small documented procedure.
2. A narrow deterministic helper for demonstrably missing inventory, backup, or resume facts.
3. Any broader design only if you can show why the first two are insufficient.

Trace which operations and role boundaries already exist. Identify duplicate safety checks, unnecessary requirements, and parts of the draft we should delete or defer. Does the current plan accidentally turn an escape hatch into another lifecycle engine? Is default source preservation compatible with selected task archival in the actual code?

Challenge whether one approval is a worthwhile goal. Distinguish meaningful user authorization from incidental per-command ceremony; do not suggest bypassing the final unplug digest check. Recommend the smallest useful deliverable, with concrete plan edits and an observable improvement over the reported manual recovery.

## Requested output

Lead with approve / approve with targeted amendments / rethink, with reasons. Then provide:
- What you actually inspected, with commit and file/function citations.
- Existing capabilities versus genuinely missing capabilities.
- Specific deletions or amendments to the plan.
- Minimal implementation and verification scope, including what NOT to build.
- Remaining uncertainties and the cheapest checks that resolve them.

Clearly separate source-confirmed facts, supplied incident context, inferences and hypotheses. Do not manufacture findings or treat consultation as acceptance evidence. A concise answer is welcome; include detail where a decision depends on it.

