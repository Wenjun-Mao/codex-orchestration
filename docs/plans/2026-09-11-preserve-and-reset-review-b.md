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

## Your distinct role: safety and connections between stages

Adversarially trace the full journey:
failed active workflow → verified preservation → quiescence → honest termination/cancellation and report retirement → selected task archival → exact unplug → fresh admission and useful work.

Determine the correct ordering from code; the arrow list is a candidate, not an imposed sequence. Find circular prerequisites, authority ownership mismatches, unsafe gaps and impossible postconditions. In particular:
- How can owners terminate runs while quiescence is required? What must be stopped, and when?
- Can cancellation/report retirement and archival safely occur in the proposed order?
- What survives when archive succeeds but its result is ambiguous, or the process stops after cancellation or during unplug?
- Can existing records support resume after their metadata roots are removed, without introducing a second journal?
- What protects source when native archival may reclaim a worktree?
- How do shared Git common directories, provisional identities, delayed reports, concurrent writers and source/plan drift affect exact scope?
- Can a bounded initial authorization cover predictable transitions while preserving the final digest check, or are two explicit approvals simpler and safer?

Prioritize plausible, code-grounded failures that change our design decision. Do not propose a distributed-systems redesign or exhaustive combinatorial test matrix. Identify the smallest connected tests and one live journey that would discriminate between a safe implementation and a merely plausible wrapper.

## Requested output

Lead with approve / approve with targeted amendments / rethink, with reasons. Then provide:
- Actual inspected commit and source citations.
- A compact stage/owner/precondition/postcondition map.
- Material failure cases: evidence, consequence, minimal correction or unresolved question.
- Concrete plan amendments, distinguishing blockers from optional improvements.
- A minimal evidence set for acceptance, separating CLI fixtures from host-dependent checks.

Separate source-confirmed facts, supplied incident context, inferences and hypotheses. If host behavior is unobservable from GitHub, say so and name the exact local check needed. Do not treat the prior manually recovered incident as proof of uninterrupted reset or safe replay.

