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
and route UUIDs. Workers register at startup using their native ID and the manager
ID in the brief; manager registration is an idempotent fallback. A missed early
final can be read natively, not synthetically replayed.

The hook reads without writing, looks up the current sender title, and submits one
native queue message. Title lookup gets at most 500 ms and a quarter of the remaining
send deadline; if unavailable, attribution uses the sender UUID. Continued Stop finals
are forwarded too. Client IDs are stable for the same route, task, turn, and exact
report body; changed bodies get distinct IDs. Native duplicate suppression is not
guaranteed. It never retries an ambiguous send.
Delivery is not proof of work or acceptance. Missing routes are quiet; malformed
state and transport failures are diagnostics.

Registry mutations use atomic replacement and a short exclusive lock.
Use `inspect-lock` and explicit `recover-lock --token EXACT --commands-stopped`
only after all competing registry commands have stopped; locks never expire automatically.
Handled initialization failures remove the exclusively created incomplete file.
If a crash leaves an incomplete lock without a usable token, first stop all competing
registry commands, resolve the project's actual Git common directory, and inspect
its `relay/routes.lock`. Only after confirming that exact file is an incomplete regular
file (not a symlink), manually remove that lock alone. Keep `routes.json` intact;
do not infer safety from lock age or use project reset to recover a lock.

## Supported installation

The current transport targets local macOS Codex Desktop through
`/Applications/ChatGPT.app/Contents/Resources/codex`, with the default `~/.codex` home.
`node` (20.11+) must be available to the hook and `git` to registry discovery.
The plugin's hooks must be enabled and trusted: visible skills or successful
registration alone do not establish hook delivery. Other hosts/homes are not qualified.
Queue acknowledgement is not recipient receipt; helper-cleanup warnings do not erase
an exact queue acknowledgement. Unconfirmed sends remain nonblocking stderr diagnostics.

## Upgrade from 0.3
This is a replacement, not a second mode. Old lifecycle commands are unsupported.
Do not switch an active old assignment's runtime. At a quiet checkpoint, preserve
wanted work, archive finished tasks, and explicitly retire old state before registration.
Legacy `control.json` is rejected, never migrated or erased automatically.

See the direct/deliver/brainstorm-and-plan skills and [decision](docs/decisions/0008-reporting-only.md).
Older decisions and acceptance notes in the source tree are historical, superseded
where they describe lifecycle enforcement; they are not shipped in the 0.4 runtime.
