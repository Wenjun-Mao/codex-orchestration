# ADR 0018: Native-subagent selector and host-name boundary

## Status

Accepted for v0.6.

## Context

Codex Orchestration primarily coordinates separate visible tasks, but v0.6
also permits bounded read-only native subagents for supporting research and
review. The current Codex host accepts model and reasoning overrides only when
the subagent does not fork the full parent history. A full-history fork inherits
the parent model and effort, so sending explicit heterogeneous selectors with
`fork_turns: "all"` is an invalid host request.

Workflow task IDs also permit characters that native subagent task names do
not. Passing a workflow ID directly to the native host could therefore reject a
valid content-addressed workflow for an unrelated naming reason.

## Decision

- A v0.6 native-subagent task must use `fork_turns: "none"` or a positive
  integer string. Full-history forks are rejected because this plugin records
  an explicit model and reasoning request.
- Ultra remains forbidden by the v0.6 plugin contract. This is a bounded-cost
  product choice, not a claim that the native host cannot run Ultra.
- The native task name is derived deterministically from the workflow task ID:
  a lowercase/underscore slug plus a digest suffix. The workflow task ID
  remains the durable orchestration identity.
- One generated subagent contract authorizes one persisted spawn attempt and
  one native agent identity. Ambiguous or expired host results fail closed and
  do not authorize another attempt.
- Native subagents may not spawn nested subagents through this workflow. They
  receive no visible-task branch, callback, integration, archive, or cleanup
  authority.
- “Read-only” is plugin authorization backed by unchanged-Git proof. Native
  subagents share the host filesystem; the host is not treated as an isolation
  boundary.

## Rejected alternatives

- Send selectors with a full-history fork and rely on host tolerance. This is
  incompatible with the current native contract and makes accepted evidence
  ambiguous.
- Silently inherit the coordinator model. That defeats the explicit
  heterogeneous-routing purpose of this plugin lane.
- Restrict all workflow task IDs to native task-name syntax. Workflow identity
  is a broader product contract; a derived adapter name is the narrower fix.
- Treat a failed or ambiguous spawn as permission to retry or substitute a
  visible task. Either action would create a second execution authority.

## Consequences and guardrails

- A caller that needs full parent history must use the native inherited model
  outside this explicit-selector contract, or provide bounded context to a
  separate visible task.
- Requested selectors remain configured/requested evidence until the host
  supplies stronger accepted or observed evidence.
- Host-name derivation is deterministic and tested; it is never used as result,
  dependency, or integration identity.
