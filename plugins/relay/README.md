# Relay

Relay maps workers to managers and forwards their actual Stop finals:

```text
From: current task title

unchanged final output
```

No lifecycle contracts, report-body storage, verification gates, or LLM delivery calls.
Managers still coordinate writes, review work, and archive finished tasks.

```sh
node bin/relay.mjs register --repo /project --worker WORKER_UUID --manager MANAGER_UUID
node bin/relay.mjs status --repo /project
node bin/relay.mjs unregister --repo /project --worker WORKER_UUID --manager MANAGER_UUID
```

Same-host native Codex tasks in Git repositories only. Routing lives in the Git common
directory at `relay/routes.json`; it contains only schema, worker IDs, manager IDs,
and route UUIDs. Register real IDs before the manager becomes idle. A missed early
final can be read natively, not synthetically replayed.

The hook reads without writing, looks up the current sender title, and submits one
native queue message with a stable client ID. It never retries an ambiguous send.
Delivery is not proof of work or acceptance. Missing routes are quiet; malformed
state and transport failures are diagnostics.

Registry mutations use atomic replacement and a short exclusive lock.
Use `inspect-lock` and explicit `recover-lock --token EXACT --commands-stopped`
only after all competing registry commands have stopped; locks never expire automatically.

## Upgrade from 0.3
This is a replacement, not a second mode. Old lifecycle commands are unsupported.
Do not switch an active old assignment's runtime. At a quiet checkpoint, preserve
wanted work, archive finished tasks, and explicitly retire old state before registration.
Legacy `control.json` is rejected, never migrated or erased automatically.

See the direct/deliver/plan skills and [decision](docs/decisions/0008-reporting-only.md).
Older decisions and acceptance notes in the source tree are historical, superseded
where they describe lifecycle enforcement; they are not shipped in the 0.4 runtime.
