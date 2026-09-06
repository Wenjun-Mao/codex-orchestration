# ADR 0052: MIT source license

- Status: accepted for v0.9.6
- Date: 2026-09-06
- Supersedes: ADR 0012's deferred licensing decision only

## Context

The public repository remained `UNLICENSED`, so visibility did not grant clear
rights to use, modify, or redistribute the source. There are no third-party
runtime dependencies or existing notice files requiring preservation.

## Decision

License the repository under the standard MIT License with copyright
`2026 Wenjun Mao`. Package and plugin metadata use the SPDX identifier `MIT`,
and release artifacts include the root license. `package.json` remains
`private: true`; this decision does not authorize npm publication or replace
the exact-version personal-marketplace distribution contract.

## Rejected alternatives

- Retain `UNLICENSED`; public readers would still lack reuse rights.
- Use a custom license; it would add ambiguity without a product requirement.
- Treat licensing as package publication; source rights and distribution
  authority are separate contracts.

## Consequences and guardrails

Source users receive the permissions and warranty disclaimer in `LICENSE`.
Validation checks exact metadata agreement, the approved copyright line, and
artifact inclusion. Any future dependency or bundled asset must preserve its
own applicable license and notice terms.
