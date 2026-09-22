You are independently reviewing a proposed serial-first architecture for Codex Flow, a personal Codex orchestration plugin. Assume no prior conversation context. This is a plan review, not an implementation assignment.

Repository: https://github.com/Wenjun-Mao/codex-orchestration
Plan: docs/plans/2026-09-11-serial-first-delivery.md
Review the immutable documentation checkpoint supplied with this prompt. Runtime source is still the published v0.9.13 baseline, a0e786cf69f3a671879ebe87fbec404b1dbbea00; intervening checkpoints contain planning documents only. Verify and state the actual full commit inspected.

Access is GitHub-only: you cannot inspect local task histories, host services, pilot repositories, backups or installed App behavior. If exact repository access fails, say so and distinguish a conceptual review from source verification. Do not silently substitute another revision. The plan's host-feasibility probe has NOT been run.

Context:
The user estimates 98% of their work has no concurrent source edits. Current visible executors require separate linked worktrees and branches; coordinator cleanup treats its checkout as disposable. Several previous iterations encountered lifecycle-boundary and cleanup problems. This is motivation, not proof that shared-checkout delivery is safe or simpler overall.
A recently proposed preserve-and-reset procedure is paused in favor of removing unnecessary isolation and cleanup from the normal path. Existing supported recovery remains available; redesigning reset is not this assignment.

Proposed normal path:
One retained primary checkout, one admitted source writer at a time, coordinator-only work or sequential coordinator/executor handoff, verified direct committed results, final reporting and acceptance, and archival of finished tasks WITHOUT checkout/branch reclamation. Read-only review may run concurrently. Separate worktrees remain an explicit choice for concurrency or isolation.
Checkout and branch are separate: use the deliberately selected existing branch (including main), never silently switch it. No automatic push or publication. Keep existing assignments on their pinned contracts; no live migration.

Inspect the plan and relevant source, following dependencies as needed:
- skills/direct, skills/coordinate, skills/execute
- templates/references/parallel-execution.md and host-operations.md
- templates/references/assignment-and-reporting.md
- lib/core/task-launch.mjs, lib/coordinator-work.mjs
- lib/iteration-registry.mjs, lib/assignment-acceptance.mjs
- lib/report-routes.mjs and associated hook/locator code
- relevant existing tests and schemas

Constraints:
Preserve exact identity, honest failures, verified results and recoverable source. Do not fabricate branch integration for shared-checkout results. No second lifecycle engine, generic lock service, daemon, dashboard, cross-host design or broad recovery rewrite by default. Flow admission checks cannot physically prevent arbitrary shell/editor writes; claims must respect that boundary. Host archival behavior must be verified live, not inferred from repository code.

Challenge the premise freely. A simpler alternative, a conditional recommendation, or rejecting part of the plan is welcome. Do not manufacture findings merely to fill a review.

Your role: adversarial ownership and connected-lifecycle safety.

Trace coordinator → serial executor → coordinator → acceptance/archive → useful successor in one retained checkout. Identify exact ownership, preconditions and postconditions. Can existing preparation, launch, receipt, route and locator contracts distinguish simultaneous task identities sharing a path? Inspect discovery and retirement, not only registration.

Challenge writer admission across package namespaces and existing isolated assignments; transfer/crash ordering; stale workers, receipts and retries; source drift and read-only checks against moving files; background tools; dirty failures; direct-result verification and dependency completion; and archival of native local tasks without reclaiming their checkout. A shell/process is not fenced merely because an API rejects its next request.

Determine the minimum enforceable ownership contract without leases or a new lock service by default. Classify each concern as a confirmed existing assumption, proposed-design risk, or host-dependent unknown. Do not treat an unimplemented serial path's missing features as regressions in v0.9.13.

Specify the smallest useful native feasibility probe BEFORE runtime implementation. Identify what repository evidence cannot prove and what exact observed host result would disqualify or change the design. Then propose a bounded connected test set, not an exhaustive combinatorial matrix.

Requested output:
1. Verdict and material prerequisites.
2. Compact stage/owner/authority map.
3. Prioritized counterexamples with source evidence, consequence and minimum correction.
4. Concrete plan amendments and explicit safe-stop boundaries.
5. Minimum fixture and live evidence, clearly separated.
6. What NOT to build or claim.

Cite exact files/functions at the inspected commit for consequential source claims. Label source-derived scenarios unexecuted unless reproduced. A request for stronger checks is not itself proof they are needed; focus on scenarios that change the design decision.

