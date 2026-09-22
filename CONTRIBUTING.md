# Contributing

Work in the owning product under `plugins/`. Keep code, tests, skills and product
docs together; root docs are for shared decisions only. No new shared framework
without a demonstrated need. Follow repository coding standards and record durable
contract changes in the product's decision records.

Relay is active. Run `npm --prefix plugins/relay run release:check` for its full
source and relocated-package checks. Flow is retired; its historical contribution
guide is at [plugins/flow/CONTRIBUTING.md](plugins/flow/CONTRIBUTING.md).

Never edit installed caches. Install from a verified product package. Preserve
existing tags and unrelated project state. Repository reorganization is not an
instruction to migrate or erase users' project registries.
