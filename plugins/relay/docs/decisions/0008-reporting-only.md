# 0008 — Reporting-only Relay

Status: accepted; supersedes lifecycle enforcement in decisions 0001–0007.

## Problem
The worker-to-manager reporting relationship was embedded in a source lifecycle
controller. Managers already reviewed work, while contracts, baselines, immutable
records and recovery commands imposed additional setup and failure boundaries.
The existing hook already forwarded text independently of result verification,
but still had to load the controller to discover its recipient.

## Decision
Replace the controller with one atomic worker-to-manager routing registry in the
Git common directory. Keep the existing bounded native queue transport unchanged.
Register real task IDs, preserve registration identity on replay, and require the
expected manager to unregister. Stop finals are messages, not success evidence.
Models, scope, tests, Git ownership, acceptance and archival remain manager work,
not registry fields or runtime gates. No report bodies or delivery journals persist.

## Alternatives and consequences
A lite mode or retained optional verifier would preserve two contracts and their
maintenance burden. Automatic legacy conversion could strand active old workers.
Instead, reject old control state and transition explicitly at a quiet checkpoint.
Reporting does not prevent concurrent edits or guarantee delivery after a transport
error. Skills require serial coordination and truthful review; ambiguous sends are
not retried. The native client ID provides stable deduplication identity, not a new
local exactly-once protocol. In-flight sends may complete after route removal.

## Guardrails
Serial dispatch explicitly selects the retained checkout where authorized, rather
than inheriting a worktree default. Isolation needs a stated reason or user request.
Workers never delete their own task directory or branch; managers clean up after
final receipt and idle confirmation. A Codex Usage worker deleted its worktree
before its final, preventing all Stop hooks from launching. This is a workflow
ordering correction, not a new reporting gate.

Workers register at startup using their native ID and the manager ID in the brief.
Manager registration remains an idempotent fallback. In ADE, a worker ran to
completion while the manager's task-list lookups did not expose it; no route was
registered. Registration belongs on the side that already knows both IDs, not
behind provisional-ID discovery. No discovery poller, handshake, or runtime change
is needed. Missing/conflicting IDs are reported rather than guessed; already-ended
unregistered finals are read natively, never replayed through a synthetic Stop.

Test routing replay/conflicts, locks/atomicity, malformed and legacy state, shared
worktrees, unchanged source, exact forwarding and native response validation.
Package only routing dependencies. Keep historical decisions outside the runtime.

## Context-efficient review
Briefs supply relevant entrypoints; workers prepare concise, review-ready finals
with change/evidence pointers and verification limits. Managers use targeted reads
and independent, risk-based review rather than reconstructing the whole work session.
Routine completion uses Relay instead of polling. This addresses repeated discovery
and oversized tool output, not review quality: no mandatory report schema, extra
files, automated acceptance, or claimed token-saving percentage is introduced.

Directors and coordinators reuse workers for review fixes and follow-up work on
the same assignment, archiving after review and completion. Separate assignments
use new tasks where native creation is authorized. This preserves useful context
without treating each final response as a reason to replace the worker; no runtime
lifecycle tracking is added.

An active native Goal is the exception to ending the manager's turn for idle
availability: continue useful independent work, or use bounded native task waiting
when dependent on a worker. Serial-write restrictions and user communication remain.
Ending a turn does not itself pause the Goal; native lifecycle and budget rules
still govern. Relay forwarding is unchanged, with no Goal state in its registry.
See [native Goal continuation](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex#how-goals-are-designed-in-codex).

## Collaborative planning — 2026-09-23

The plan skill previously requested clarification without describing an interactive
design conversation or selecting native question tools. Adapt the core ideas of
[Superpowers brainstorming](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md):
establish shared intent, ask focused questions, compare real alternatives, review the
design, and scale planning depth to the task. Prefer available native question UI
within host restrictions, falling back to chat; a skill does not activate Plan mode.
Keep this in one skill, not a new runtime or separate brainstorming workflow. Reject
mandatory per-stage approvals and automatic heavier-process escalation; preserve
the implementation approval boundary and check plan coherence before handoff.
Validation should distinguish instruction/package checks from observed UI behavior.

## Manager-side model guidance — 2026-09-22

Use a small, difficulty-based preference in the direct skill, shared by directors
and coordinators, applying equally to coordinator, executor and native subagent
selection. Luna/Max is the user-selected default for all Luna calls unless explicitly
overridden. Sol/Medium is the starting point for
challenging work, with High/Xhigh optional for more demanding judgment. Choose
directly, not through a mandatory escalation ladder; broader judgment can justify
Sol rather than Luna/Max. Do not duplicate model
choices in worker briefs, registry fields or runtime validation. User choices and
native dispatch permissions still govern; no automatic fallback or escalation engine.
Whichever role launches a native subagent announces its purpose, model and effort
before spawning, matching the actual configuration and disclosing inherited or
unverified settings. Both direct and deliver carry this visibility rule; it adds
no registry fields, worker-brief requirements or runtime checks.

The [Codex model guide](https://developers.openai.com/codex/models) recommends
starting at Luna/High and Sol/Medium. Our Luna/Max preference instead follows the
user's quality/cost tradeoff after reviewing the [launch evaluations](https://openai.com/index/introducing-gpt-6-sol-and-luna/);
it is not a claim that Max is always faster or cheaper per task. Standard short-context
[API prices](https://developers.openai.com/api/docs/pricing), per million input/output
tokens, are $0.10/$0.50 for GPT-6 Luna and $2/$10 for GPT-6 Sol, versus
$0.20/$1.20 for GPT-5.6 Luna and $2/$12 for GPT-5.6 Terra. These are dated API
rates, not Codex subscription usage estimates or proof of universal Luna/Terra
capability parity. Review real task outcomes before broader capability claims;
retired Flow guidance remains historical rather than becoming a second maintained policy.
