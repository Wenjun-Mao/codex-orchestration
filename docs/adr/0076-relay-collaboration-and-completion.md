# ADR 0076 — Direct collaboration, hook-owned completion

Status: implemented for Relay 0.3.0, 2026-09-12. The recovered RC1 native journey
qualified the connected lifecycle; see Relay decision 0004 and its release evidence.
Existing 0.2.1 assignments retain the worker continuation from decision 0003.

2026-09-12 amendment: Relay decision 0005 decouples stopped-turn communication
from source acceptance. Unsealed Stops also notify with separate deterministic
status, never completion/cleanup authority. This corrects the suppression boundary
below; the original rationale is retained as history. Source candidate 0.3.1-rc.1
is tested but not yet installed or natively qualified.

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

This supersedes decision 0003's worker-continuation choice for new assignments.
Experimental queue transport was explicitly accepted and qualified; compatibility
and connected native evidence are recorded under the
[implementation plan](../../plugins/relay/docs/plans/2026-09-12-relay-hook-owned-reporting.md).
Do not modify the installed path before its replacement is verified.

## Deferred decision-record audit

The user suggested a later independent Pro audit of the evolving ADRs. Candidate
scope: contradictions, explicit supersession/current status, Flow-versus-Relay
applicability, implementation/evidence mismatches, and unnecessary constraints.
Review connections between decisions, not prose alone. This is a recorded follow-up,
not a commissioned consultation, new implementation scope or prerequisite to every
change. Preserve historical rationale rather than silently rewriting old decisions.
