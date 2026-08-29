# Examples

`v0.6-workflow-draft.json` is the only user-authored v0.6 example. The runtime
canonicalizes it, persists the workflow revision, and generates task contracts
and lifecycle records. Do not copy or hand-author operation IDs, nonce evidence,
callback IDs, dispositions, integration records, verification hashes, or
archive records; those derive their authority from persisted state.

The remaining JSON files in this directory are v0.5.1 historical fixtures kept
temporarily for predecessor schema and regression tests:

- `parallel-plan.json`
- `task-packet.json`
- `task-thread-packet.json`
- `host-capability-evidence.json`
- `host-observation-evidence.json`
- `terminal-receipt.json`
- `urgent-signal.json`

They are not active v0.6 operating guidance and must not be used to author a
new run.
