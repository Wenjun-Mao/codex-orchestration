# ADR 0041: Coordinator identity and provisional selector boundary

## Status

Accepted for the v0.8.1 hardening checkpoint.

## Context

The lifecycle journal previously authenticated a coordinator lineage against
its persisted recipient binding, but activation and rebind did not compare that
lineage with the task currently exposed by the host. A different task could
therefore submit matching lineage data and record coordinator authority.

Visible task creation also allowed observed selector evidence while only a
provisional client-thread identity existed. Such evidence describes the ready
task session, so it must not become durable before that task identity is
authenticated.

## Decision

`run activate` and `run rebind` require `CODEX_THREAD_ID` to match the
activation coordinator or rebind resume coordinator before activation state is
acquired or the recipient is advanced. Provisional and terminal no-ready
creation phases may preserve host-accepted selectors, but reject observed
selectors. Only `ready-unreleased` may retain selector observations.

Successful activation and rebind disclose the invoking task ID, the
`codex-environment` evidence source, and the successful match. This is a
host-exposed accidental-misbind guard, not cryptographic task attestation;
`CODEX_SESSION_ID` is not part of the contract and there is no override.

## Consequences and guardrails

Headless callers that cannot expose a current Codex task cannot activate or
rebind coordinator authority. Focused CLI and task-creation tests cover wrong
current-task rejection and premature observed-selector rejection. The schema
mirrors the phase rule; runtime validation remains authoritative for existing
records and all mutation paths.
