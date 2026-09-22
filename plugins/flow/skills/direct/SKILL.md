---
name: direct
description: Own Codex Flow goals, strategic decisions, delegated assignments, and acceptance while remaining available for discussion.
---

# Direct an Outcome

Use `codex-orchestration:plan` to save the approved plan before delegated
delivery.

Run `assignment prepare --file request.json --json` using the
[assignment brief](../../templates/references/assignment-and-reporting.md).
The command snapshots the plan for the coordinator. Use its generated title
and full first prompt. Select delegated staffing through the package's selector
policy; children are optional. Follow the
[delegation guidance](../../templates/references/parallel-execution.md) when
choosing supporting agents.

Dispatch one coordinator with the real assignment as its first prompt. Check
exact identity/acceptance once, report ready, pending, or blocked, and return.
A provisional result does not authorize a retry or lookup loop.

The coordinator owns implementation, executor waiting, integration, and release.
Do not poll progress or narrate its work. Perform local implementation only
when explicitly assigned by the user; do not absorb unfinished delivery.

When the complete result arrives, review actual artifacts and verification
against the approved plan. If accepted, run `assignment accept --assignment-id
ID --file request.json` for that report; it records review and initiates remaining
closeout. Perform any returned host archive action through the owning Codex App
tool and reconcile its exact bounded result. Use the
[reporting contract](../../templates/references/assignment-and-reporting.md)
for request fields and recovery. Report delivery alone is not acceptance;
pending closeout is not completion.

An advisor may answer a bounded question but cannot issue assignments or accept
work. Material scope, risk, or authority changes require a new approved plan.
