# Contributing

Issues and pull requests are welcome. For vulnerabilities, use the private
channel in [SECURITY.md](SECURITY.md), not a public issue.

## Development

Codex Orchestration requires Node.js 20.11 or newer and has no third-party
runtime dependencies. Fork or branch from current `main`, keep changes focused,
and follow the repository's existing module and decision boundaries.

Run the smallest relevant test first, then the combined checks before opening a
pull request:

```bash
npm test
npm run validate
npm run pack:check
git diff --check
```

Changes to durable architecture, lifecycle or schema contracts, distribution,
or workflow policy need a concise ADR in `docs/adr/`. Routine implementation
details do not.

## Releases

Do not move or reuse a published version or tag. Approved unreleased work may be
combined into one useful release, while necessary release candidates and checks
remain mandatory. See [ADR 0053](docs/adr/0053-consolidated-release-candidates.md)
for the standing policy and its limits.

This package remains `private: true`; contributing does not authorize npm
publication or a stable release.
