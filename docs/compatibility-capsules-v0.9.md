# v0.9 compatibility capsules

Compatibility remains finite and evidence-bound. A capsule is retained only
for a named predecessor or host gap, with a narrow authority and a testable
exit. It is not a general predecessor reader, journal migration path, or
silent fallback.

| Capsule | Narrow authority | Evidence boundary | Exit condition |
| --- | --- | --- | --- |
| Private ready-task resolution | Resolve the exact provisional visible-task operation when Codex App's public catalog omits its ready ID. | Exact nonce-bearing bootstrap, coordinator identity, selector, placement, event-window, and matching App evidence; ambiguity fails closed. | Retire when Codex App exposes a public, operation-bound provisional-to-ready mapping with equivalent bootstrap, selector, and event evidence. |
| Exact-v0.8.1 source recovery bridge | Read the exact v0.8.1 source authority through its immutable exporter and emit an external reconciliation request. | Only the authenticated v0.8.1 snapshot may parse or mutate its source journal; the bridge creates no task and performs no migration. | Remove after no supported retained source run needs v0.8.1 recovery and a separately authorized clean-start/retention review confirms removal is safe. |
| Long-lived coordinator refresh | Hand off one coordinator from its immutable source runtime to a fresh target run after source executor disposition. | Content-addressed handoff, exact source/target runtime identity, archive observation before local cleanup, and fresh selector and Git identity for each replacement task. | End the handoff after its recorded `consumed` clean-start or replacement activation; do not retain a reusable migration capability. |

The first two capsules are derived from [ADR 0042](adr/0042-long-lived-private-task-resolution.md).
The third is the bounded refresh lifecycle in
[ADR 0040](adr/0040-long-lived-coordinator-refresh.md). The runtime snapshot,
one-shot task creation, and foreign-active-run sentinel are core safeguards,
not compatibility capsules; they therefore do not become open-ended adapters.

Any proposed capsule must name its predecessor/host gap, authority, evidence,
failure behavior, test coverage, and removal trigger before it is admitted.
