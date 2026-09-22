# v0.3.2 orchestration coverage

## Covered

- Fresh and migrated project configuration selects one ordinary-completion
  authority: `journal-monitor` with notification transport `none`.
- Legacy v0.3.1 configuration requires an explicit read-only plan and matching
  apply option; sync and normal commands fail closed before migration.
- Journal delivery performs no host queue call, preserves deterministic
  callback identity, and retains exactly-once observe/consume behavior.
- Task packet defaults reject ordinary-completion authority drift.
- Callback schema v3 separates integration and notification lifecycle.
- Legacy schema-v2 records remain readable without mutation and expose bounded
  potentially-live notification risk through status, doctor, and cleanup.
- Optional adapter fixtures prove stable queue identity, pointer-only payloads,
  inspect-before-retry recovery, retract-before-monitor-consume,
  retract-before-supersede, retract-before-expire, started/delete races,
  ambiguous outcomes, and no host call while a journal lock exists.
- Managed and external-AGENTS installation modes, task baseline
  authentication, recipient fencing, task-operation reconciliation, leases,
  and audit-only cleanup retain their prior coverage.

## Partial or host-dependent

- Capability-probed queue add/list/delete is a library adapter contract only.
  No production Desktop adapter is enabled.
- Legacy queue risk clears when the actual queue turn is observed, but the
  original unidentified submission cannot be proactively retracted.
- Journal-monitor delivery is durable but intentionally does not wake an idle
  coordinator through a user-turn queue.

## Not claimed

- Real-host elimination of stale turns through experimental queue CRUD.
- Retraction of queue entries created by v0.3.1 `codex queue`.
- Independent post-creation observation of task model/reasoning where the host
  does not expose those fields.
- Guaranteed task archival when host list/read/archive controls are
  unavailable.

## Adoption gate

Package tests, source validation, and package dry-run must pass. The next UK Dev
pilot should install v0.3.2 on a dedicated branch, explicitly migrate its
project authority, launch only new executors under journal-monitor, and prove
that ordinary completion is observed and consumed without creating a new
queued user turn. Existing active v0.3.1 executors remain legacy and are not
silently migrated.
