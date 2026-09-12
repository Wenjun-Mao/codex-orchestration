# ADR 0076 — Direct collaboration, hook-owned completion

Status: accepted design direction, 2026-09-12; not implemented. Applies to Relay.
Installed 0.2.1 still uses the worker continuation described in Relay decision 0003.

## Decision

Use **direct messages for collaboration; hook-owned reporting for completion**.

Mid-work questions and blockers are intentional worker-to-manager messages. When
an answer is necessary, the worker awaits it through a verified host mechanism and
then resumes; independent in-scope work may continue when safe. A question or ended
turn is not completion. The Stop hook may execute but must not announce completion
without the sealed result required by Relay's contract. Verify question/answer/resume
behavior rather than assuming `wait_threads` is an arbitrary reply mailbox.

After verification and source release, the worker writes its final response. The
hook captures that final and directly notifies the assignment's exact manager.
Workers need no separate completion-send instructions or notification-only model
turn. Result quality and truthful final output remain worker responsibilities;
receipt, semantic review, acceptance/rejection and cleanup remain manager duties.

The hook is the primary automatic completion path, not a second sender checking
whether the worker remembered. Keep notification distinct from successful delivery
or acceptance. Preserve readable reports and visible transport failures; do not
promise infallible or exactly-once notification.

## Rationale and boundaries

Direct messaging for both cases depends on workers remembering completion sends.
Hook delivery for both cases would require classifying questions, progress and final
results, expanding a completion hook into a general messaging framework. The split
keeps intentional collaboration flexible and automatic completion deterministic.

This supersedes decision 0003's worker-continuation choice as the target design,
not as a claim that shipped behavior has changed. Transport feasibility, explicit
acceptance of any private/experimental dependency, compatibility and connected
native qualification remain gates in the [draft implementation plan](../plans/2026-09-12-relay-hook-owned-reporting.md).
Do not modify the installed path before its replacement is verified.

## Deferred decision-record audit

The user suggested a later independent Pro audit of the evolving ADRs. Candidate
scope: contradictions, explicit supersession/current status, Flow-versus-Relay
applicability, implementation/evidence mismatches, and unnecessary constraints.
Review connections between decisions, not prose alone. This is a recorded follow-up,
not a commissioned consultation, new implementation scope or prerequisite to every
change. Preserve historical rationale rather than silently rewriting old decisions.
