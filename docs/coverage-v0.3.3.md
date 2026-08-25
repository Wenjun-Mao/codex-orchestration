# Codex Flow v0.3.3 coverage

## Covered

- Required host-capability preflight before every nonlegacy task-creation attempt.
- Fail-closed execution-kind, model, and reasoning selector classification.
- Zero-attempt rejection for unsupported or unverified required selectors.
- Session-bound serializer/backend/adapter/schema/control failure and retry only
  after a different compatible host-session preflight.
- Immutable preflight history with per-attempt provenance.
- Exact task-thread title reread, including bounded host title normalization.
- Subagent title-unavailable handling with a separate host nickname.
- Field-level visibility, model, reasoning, and title evidence provenance.
- Filtered-list rejection with declared bounded-unfiltered or exact-read fallback.
- Read-only legacy operation-v1 migration and safe write-time schema-v2 upgrade.
- Doctor and cleanup reporting for incompatibility, blocked sessions, partial
  evidence, and legacy records.
- All v0.3.2 journal-monitor callback and notification-lifecycle regressions.

## Real-host evidence

UK Dev supplied held-out v0.3.2 evidence that explicit Terra/xhigh task-thread
creation failed with serializer errors before a reboot, then succeeded after the
reboot. The successful visible thread required a bounded title update because
the host initially used the delegation envelope. Its journal-monitor callback
was observed and consumed exactly once with no ordinary queue notification.

That evidence motivates this contract, but it is not a v0.3.3 installation field
test. See the identifier-free
[UK Dev host-session observation](field-tests/2026-08-24-uk-dev-v0.3.2-host-session.md).

## Partial or host-dependent

- Host-session identity is supplied by the active host adapter or coordinator;
  the dependency-free package cannot derive a Desktop process generation.
- Some host list/read responses do not independently expose model or reasoning.
  Reconciliation records host acceptance or role contract without calling it
  host-observed.
- Task visibility and archive status depend on the available host controls.
- A filtered list query may be advertised but rejected at runtime; only the
  declared bounded fallback is trusted.

## Not claimed

- No v0.3.3 package field test has yet created and reconciled a real host task.
- No package-owned host daemon, MCP server, or mandatory app-server adapter.
- No automatic task archival, deletion, or host-session discovery.
- No migration of already active v0.3.2 executors.
