# Codex Orchestration

One repository for independently maintained personal plugins and standalone skills.

| Product | Status | Source |
|---|---|---|
| Relay | Active — worker-to-manager report forwarding | [plugins/relay](plugins/relay/README.md) |
| Flow | Retired for now — preserved for reference | [plugins/flow](plugins/flow/README.md) |

Each plugin owns its runtime, skills, tests, packaging and product documentation.
Standalone skills keep their instructions and supporting resources in `skills/<name>`.
Root `docs/` holds repository-wide decisions, consultations and the
[known-issues checklist](docs/known-issues.md). No shared runtime or build framework.

## Standalone skills

| Skill | Purpose | Source |
|---|---|---|
| External Consultation | Prepare, review and integrate outside consultation | [skills/external-consultation](skills/external-consultation/SKILL.md) |
| Codex Usage Retrospective | Explicitly invoked, read-only review of recent Codex work | [skills/codex-usage-retrospective](skills/codex-usage-retrospective/SKILL.md) |
| Relay App Check | Repo-local native Stop-hook check with one disposable worker | [skills/relay-app-check](skills/relay-app-check/SKILL.md) |

Repository `skills/` is the authoring source, not a Codex discovery or installation
location. Deploy changes deliberately to the user's skill location; do not maintain
installed copies as a second authoring source. The initial External Consultation
import left its installation unchanged. Codex Usage Retrospective is deliberately
installed from a pinned source revision; invoke it with `$codex-usage-retrospective`.
Relay App Check is exposed only in this repository through
`.agents/skills/relay-app-check`, a relative symlink to its source directory. It is
not globally installed or shipped with Relay. No automatic deployment is added.

See [standalone-skill layout decision](docs/adr/0078-standalone-personal-skills.md).

## Development

- Relay: `npm --prefix plugins/relay run release:check`; root `npm test` runs its tests only.
- Flow reference validation: `npm --prefix plugins/flow run validate`.
- Flow regression suite: `npm --prefix plugins/flow test`.
- Relay App Check helper fixtures: `node --test skills/relay-app-check/scripts/self-check.test.mjs`.

Relay releases use `relay/vVERSION` tags. Historical `vVERSION` tags belong to Flow
and retain the original root layout. Neither product is published to npm.
Use the historical tag/artifact to reproduce an old Flow release, not today's
relocated reference tree. Flow's legacy plugin identifier remains
`codex-orchestration`; no compatibility rename or new Flow release is intended.

See [repository layout decision](docs/adr/0077-multi-product-layout-and-flow-retirement.md).

Reusable host finding: [native navigation can wake queued work in an unloaded chat](docs/field-tests/2026-10-02-native-navigation-wakeup.md).
