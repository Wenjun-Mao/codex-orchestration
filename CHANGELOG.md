# Changelog

This file records concise user-facing changes. Immutable tags and the linked
decision records remain the detailed release evidence.

## 0.9.6 - 2026-09-06

- Allow an authenticated terminal direct-coordinator source with no launch
  resources to refresh into a replacement run without inventing cleanup
  authority; malformed or resource-bearing launch evidence still fails closed.
- License the source under MIT and add public contribution and security entry
  points.
- Document current coordinator routing, authenticated quiet reporting, reload
  requirements, and same-local-host limits.

## 0.9.5 - 2026-09-06

- Added authenticated report-locator retirement and recovery.
- Added a lean Terra-high route for settled bounded coordinator delivery while
  preserving Sol-high for systemic coordination.

Earlier release history is available in the repository's immutable tags and
`docs/adr/`.
