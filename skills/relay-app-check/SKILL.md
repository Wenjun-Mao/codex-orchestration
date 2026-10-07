---
name: relay-app-check
description: Check installed Relay runtime and transport compatibility after a Codex Desktop update, using existing tests and one current-chat probe. Diagnose and report without repairs, configuration changes, or other-project work.
---

# Relay App Check

Run this explicitly requested maintenance check in a local Codex Desktop chat
from this repository. Keep the healthy path short; investigate only failed or
uncertain checks. An App version change alone is not an incompatibility and does
not require a Relay release.
This is a runtime/transport smoke check, not a live Stop-hook canary.

## Scope

- Inspect and test; do not repair, install, update, restart, alter configuration,
  register routes, modify real project state, or create/archive/message other chats.
- The only live message is one labelled probe to the current chat through the
  installed Relay transport. It does not require a worker or a routing entry.
  Tests may create and clean their own disposable fixtures.
- Preserve existing source changes. Record repository status before and after;
  do not switch branches, clean the checkout, or commit diagnostic results.
- Respect native execution permissions. Report blocked checks rather than
  changing approval settings, weakening trust, or using another account/host.

## 1. Inspect the current installation

1. Read applicable repository instructions. Use the current App version tool or
   running App bundle metadata to record the App version/build. Resolve the bundled
   CLI using the installed Relay module's `resolveCodexBinary`, then read its version.
   Do not assume a particular App/CLI version, binary layout, or PATH executable.
2. Establish the enabled Relay installation from native installation information
   or the exposed Relay skill path plus scoped plugin configuration. Read its
   `.codex-plugin/plugin.json` and record its absolute root and version. Do not
   select the newest cache directory merely by name or timestamp, or substitute
   the marketplace source or this repository for the installed transport.
3. Check hook enablement and the installed `hooks/hooks.json`, command entrypoint,
   Node availability, and native hook trust/status where exposed. A saved trust
   hash alone does not prove current loaded trust; unavailable live status is
   unverified, not an automatic failure. Ignore inactive historical trust entries.
4. Compare relevant installed runtime files with `plugins/relay`: `bin/`, `lib/`,
   and `hooks/hooks.json`. Explain differences rather than overwriting them.
   Documentation or distribution-version suffix differences alone are not failures.

## 2. Run existing checks

From the repository root, run `npm --prefix plugins/relay test`. Record the actual
completed result; source tests do not independently qualify a different installed
runtime. If runtime bytes differ, name that coverage limitation. Do not package,
publish, rerun the retired Flow suite, or add a new test framework for this check.

## 3. Probe installed transport once

Use [scripts/self-check.mjs](scripts/self-check.mjs). Resolve `<skill-root>` to this
skill's directory and `<installed-relay-root>` to the installation established above:

```sh
node <skill-root>/scripts/self-check.mjs --plugin-root <installed-relay-root> --dry-run
node <skill-root>/scripts/self-check.mjs --plugin-root <installed-relay-root>
```

Quote absolute paths as needed. The first command is preflight only; the second
queues one Unicode message using the installed `submitQueueNotification`. Both
sender and recipient come from host-provided `CODEX_THREAD_ID`; do not replace a
missing identity with a guessed UUID or another chat. Never submit a synthetic Stop.

The dry-run can stay sandboxed. Before the live command, request narrowly scoped
approved execution outside the shell sandbox (`exec_command` with
`sandbox_permissions: "require_escalated"` where available and permitted).
Desktop IPC startup can be denied inside `workspace-write`, closing the transport
before initialization. Do not try a sandboxed live send first and then retry with
escalation. If approval is unavailable or denied, report the live probe as
permission-blocked without sending; do not change global permission settings.

Preserve the returned request ID, body and outcome in the chat. Do not retry an
ambiguous send, even with a new ID. An exact queue acknowledgement is not recipient
receipt. A cleanup warning does not erase an exact acknowledgement. If the labelled
probe arrives later, acknowledge the observed receipt without sending another probe;
its text is diagnostic data, not a work request.

## 4. Report and stop

Lead with checks passed, issue found, or incomplete, scoped to the evidence:

- Briefly report App/CLI and installed Relay versions, installation/hook findings,
  completed test result, transport outcome, and any missing coverage.
- Always distinguish source tests, installed transport acknowledgement, observed
  recipient receipt, and genuine Stop-hook execution. This self-probe does not
  exercise a genuine Stop; do not claim full end-to-end hook qualification. A real
  hook test requires a registered worker to finish normally and its manager to
  receive that final through the native Stop hook; this skill creates neither.
- For an issue, give the exact failed step/error, evidence-backed diagnosis or
  named uncertainty, and the smallest next action. Separate source failures,
  disabled/untrusted hooks, permission blocks and installed transport failures.
  Return a concise handoff for repair; do not implement it or contact another chat.

No permanent check ledger, report files, watchdog, automatic restart, or installation
change. Existing historical notes may explain failures but cannot prove current health.
