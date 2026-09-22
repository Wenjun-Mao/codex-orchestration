# Codex Orchestration

One repository, independently packaged plugin products.

| Product | Status | Source |
|---|---|---|
| Relay | Active — worker-to-manager report forwarding | [plugins/relay](plugins/relay/README.md) |
| Flow | Retired for now — preserved for reference | [plugins/flow](plugins/flow/README.md) |

Each product owns its runtime, skills, tests, packaging and product documentation.
Root `docs/` holds cross-product decisions, consultations and the
[known-issues checklist](docs/known-issues.md). No shared runtime or build framework.

## Development

- Relay: `npm --prefix plugins/relay run release:check`; root `npm test` runs its tests only.
- Flow reference validation: `npm --prefix plugins/flow run validate`.
- Flow regression suite: `npm --prefix plugins/flow test`.

Relay releases use `relay/vVERSION` tags. Historical `vVERSION` tags belong to Flow
and retain the original root layout. Neither product is published to npm.
Use the historical tag/artifact to reproduce an old Flow release, not today's
relocated reference tree. Flow's legacy plugin identifier remains
`codex-orchestration`; no compatibility rename or new Flow release is intended.

See [repository layout decision](docs/adr/0077-multi-product-layout-and-flow-retirement.md).
