# Orchestration and Routing: Evidence, Boundaries, and Test Plan

## Status

This is a non-normative research note reviewed on 2026-08-30. It records
hypotheses and an evaluation design; it does not change Codex Flow runtime,
schema, skill, model-routing, or release authority. Durable behavior belongs in
an ADR only after held-out evidence supports it.

## Decision summary

Do not treat “a strong coordinator plus weaker workers achieves more than 90%
of the result at about half the cost” as an established result. That statement
combines model routing, multi-agent parallelism, wall-clock speed, token use,
and provider cost from distinct studies.

No reviewed source tests Codex Flow's exact architecture: one Sol coordinator
governing multiple Terra user-visible Codex tasks in separate worktrees.
Therefore:

- retain explicit selectors, rationale, provenance, bounded ownership, and
  quiet result delivery;
- use parallel execution only when workstreams are independently executable
  and synthesis is cheaper than serial exploration;
- keep a strong single-agent run as the comparison baseline;
- treat the current Luna/Terra/Sol ladder as a testable heuristic, not a proven
  routing policy; and
- keep quality, cost, token use, and wall-clock time as separate outcomes.

## Native Codex boundary

Three execution surfaces must remain distinct:

| Surface | Native behavior | Flow implication |
| --- | --- | --- |
| Responses API multi-agent | A beta per-response hierarchy can spawn, message, wait for, follow up with, and interrupt subagents. | Research precedent only; Flow does not recreate the API runtime. |
| Codex native subagents | Child agent threads run within the parent's local Codex run. In the current host they share the workspace filesystem, but they are distinct agent threads rather than user-owned visible tasks. Model and reasoning inherit when unspecified, while explicit spawn values, agent defaults, and custom-agent configuration can override them. | Prefer for bounded read-only exploration or review that does not need independent Git or durable cross-task lifecycle. |
| User-visible Codex tasks | The App owns project placement, task identity, worktrees, messaging, waiting, Handoff, and archival. | Flow consumes these primitives and adds cross-task contracts, provenance, quiet results, integration, and cleanup proof. |

This evaluation uses a strong Sol-high single-agent baseline. Current OpenAI
guidance recommends choosing the model for the workload and using the lowest
reasoning effort that produces the required result. Native subagents and
explicit model selection are therefore wheels Flow should consume rather than
rebuild.

Primary references:

- [OpenAI model selection guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI practical guide to agent architectures](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)
- [Responses API multi-agent beta](https://developers.openai.com/api/docs/guides/responses-multi-agent)
- [Codex native subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex model and reasoning guidance](https://learn.chatgpt.com/docs/models)
- [Codex worktrees and Handoff](https://learn.chatgpt.com/docs/environments/git-worktrees)

## Evidence map

### RouteLLM: model routing, not coordinator-worker orchestration

[RouteLLM](https://arxiv.org/html/2406.18665) trains a router to select exactly
one strong or weak model for each query. It does not ask a strong model to
coordinate multiple weaker workers.

The paper reports a 3.66x cost-saving ratio at 95% of GPT-4 quality on
MT-Bench. Results were weaker on other benchmarks: 1.41x at 92% on MMLU and
1.49x at 87% on GSM8K. Its cost calculation uses the evaluated model prices and
strong-model call share, so those figures are neither a universal cost ratio
nor direct evidence about current Codex plans. Routers trained only on Arena
data performed poorly on out-of-distribution MMLU and GSM8K; small in-domain
or judge-labelled augmentations materially changed the result.

**Classification: park as evidence for Flow's multi-task architecture.** Test
the narrower routing hypothesis only if representative held-out tasks and
complete routing overhead can be measured.

### Anthropic Research: parallel breadth-first research

[Anthropic's multi-agent research report](https://www.anthropic.com/engineering/multi-agent-research-system)
describes a lead Claude Opus 4 agent coordinating parallel Claude Sonnet 4
research subagents. Anthropic reports a 90.2% improvement over a single Opus 4
agent on its internal research evaluation and up to a 90% reduction in research
time for complex queries after system improvements.

This is the closest reviewed architecture to a strong coordinator with cheaper
workers, but it is not a half-cost result. Anthropic reports that agents used
about four times the tokens of chats and multi-agent systems about fifteen
times. The report identifies breadth-first queries with independent research
directions as the strongest fit and warns that tightly coupled work is less
suitable.

**Classification: use narrowly.** Apply bounded decomposition, effort budgets,
structured worker returns, source-quality checks, and coordinator synthesis to
naturally parallel research or review. Test transfer to coding instead of
assuming it.

### ToolOrchestra: a trained heterogeneous policy

[ToolOrchestra](https://arxiv.org/html/2511.21689) trains an 8B orchestrator by
reinforcement learning to call heterogeneous tools and models. Its reward
combines outcome quality, efficiency, and preference. The paper reports
Orchestrator-8B scoring 37.1 versus GPT-5's 35.1 on HLE with tools, and exceeding
GPT-5 on two other evaluated benchmarks at about 30% of the reported cost.

The result depends on a trained policy, synthetic environments, explicit
cost/latency rewards, tool access, benchmark conditions, and provider-price
assumptions. A prompt-only Flow coordinator cannot be expected to reproduce it.

**Classification: park.** Treat learned orchestration as a future research
direction, not a current plugin feature or justification for automatic
routing.

### Nature MAS study: architecture-selection counterevidence

The [Nature Machine Intelligence study](https://www.nature.com/articles/s42256-026-01268-y)
compares one single-agent and four multi-agent architectures across 260
configurations, six agentic benchmarks, and three model families under matched
per-system compute limits.

Its results are domain-dependent. Centralized multi-agent execution improved
Finance Agent by 80.8%, while every tested multi-agent architecture reduced
SWE-bench Verified performance by 1.3% to 12.8%. Across all six benchmarks and
architectures, mean improvement was 0.0% with a wide confidence interval.
Decomposable financial work benefited; sequential PlanCraft work degraded by
39% to 70%.

The paper's approximately 45% single-agent capability-saturation threshold
predicted the sign of the multi-agent effect in a limited SWE-bench and
Terminal-Bench validation set. The authors present it as a selection rule, not
a universal scaling law. Its coding agents also shared one Docker state rather
than using Flow-style isolated worktrees, so direct transfer requires testing.

**Classification: use as a guardrail.** Admit parallelism based on task
decomposability, shared-state coupling, single-agent baseline strength, and
coordination overhead—not difficulty alone.

## Operating classifications

| Classification | Current decision |
| --- | --- |
| Use | Strong single-agent baseline; bounded coordinator-worker decomposition for independent research/review; explicit contracts and selectors; final synthesis; measured admission. |
| Test | Per-task model routing; native-subagent versus visible-task choice; centralized coordination for independent implementation slices; context-size and concurrency effects. |
| Park | A learned ToolOrchestra-like policy; automatic dynamic worker counts; benchmark-derived numerical routing thresholds; background availability probes. |
| Discard | The compound “more than 90% at half cost” premise; unconditional multi-agent defaults; treating routing evidence as proof of orchestration value. |

## Audit against v0.7.5

### Already aligned

- The coordinator and executors have separate responsibilities.
- Every task has an explicit model, reasoning effort, execution surface,
  bounded context fork, and selector rationale.
- Requested, accepted, and observed selector evidence remain distinct.
- The workflow DAG rejects cycles and overlapping unordered write/resource
  ownership.
- Routine terminal results are journaled without direct Steer; only persisted
  urgent signals use the one-shot interrupt path.
- Runtime, repository, task, Git, integration, and cleanup authority are
  authenticated rather than inferred from final text or UI status.
- Plugin skills are the sole live Flow instruction authority; activation does
  not manage `AGENTS.md`.

### Partial or missing

- The fixed Luna-medium, Terra-high/xhigh, and Sol-high rubric is reasonable
  guidance but has no Flow-specific held-out evidence.
- Parallelism has correctness admission, but no measured benefit threshold for
  quality, critical-path time, rework, or coordination cost.
- Subagent context forks are bounded, but there is no measured prompt-size or
  context-relevance policy.
- Stop rules limit instrumentation drift, but no empirical overhead budget has
  been established.
- Tests prove protocol correctness, not routing or orchestration quality.

The most plausible candidate for later thinning is the model-name-specific
routing rubric. The durable core is smaller: explicit selectors, bounded
rationale, requested/accepted/observed provenance, and fail-closed replan.
Do not thin the rubric before the evaluation establishes whether it helps.

## Held-out evaluation design

### Primary outcome

Determine when Codex Flow with deliberately cheaper workers preserves accepted
outcome quality while improving total efficiency over one strong task, and
when native subagents or a single task are the better surface.

### Causal questions

1. Does parallel execution improve quality or wall-clock time because the work
   is genuinely decomposable, after coordinator and integration overhead?
2. Does a cheaper selected model preserve task acceptance because the task is
   well specified, rather than because the benchmark is easy or familiar?
3. For which task classes does Flow's independent visible-task lifecycle
   provide sufficient provenance and continuity to justify its overhead,
   relative to native subagents?
4. Does the current model rubric predict those outcomes better than a strong
   single-agent default?

### Cheapest safe direct attempt

Run a small preregistered comparison on fixed held-out tasks after a fresh
installed-plugin authority check. Do not add automatic routing, new telemetry,
or another lifecycle before attempting the comparison with evidence already
available from Codex and the existing Flow journal.

### Cohorts

1. **Breadth research:** several independently searchable evidence streams
   whose final result needs source synthesis.
2. **Independent implementation slices:** disjoint files or modules with
   explicit interfaces and no unordered shared writes.
3. **Sequential or stateful engineering:** debugging, migrations, and
   refactors in which each decision changes the state needed by the next.
4. **Cross-cutting review and planning:** parallel inspection is possible, but
   conclusions must reconcile one shared architectural model.

Keep the cohorts fixed while prompts and routing rules are evaluated. Do not
reuse held-out tasks to tune selector rationales, thresholds, or worker counts.

### Comparisons

Use only configurations lawful for the task surface:

- one Sol-high task as the strong baseline;
- one deliberately selected cheaper single task to isolate model routing;
- one Sol-high coordinator with explicit Terra or Luna native subagents for
  bounded read-only work; and
- one Sol-high coordinator with explicit Terra visible tasks for independent
  mutating work that requires durable Git and task lifecycle.

Do not compare a read-only subagent against a visible mutating task as though
they were interchangeable. Record requested, accepted, and observed selectors
separately, and report unavailable host observations as unavailable.

Run a visible-task arm only when the evaluation authorization explicitly
permits creation of separate user-owned Codex tasks and their selected
worktree or local environments. Wait for provisional worktree setup to yield a
real task ID before messaging or measuring that task.

### Metrics

Primary metrics:

- task success or human acceptance rate;
- task-specific correctness, such as tests or a preregistered rubric;
- total end-to-end cost when the host exposes an authoritative measure,
  including coordination and synthesis; and
- elapsed wall-clock time from accepted start to accepted result.

Secondary diagnostics:

- total and per-role tokens or usage units when available;
- number of workers, tool calls, retries, waits, and coordination messages;
- rework and integration-defect rate;
- interruption or Steer events;
- citation correctness and source quality for research; and
- failure class: omission, duplication, contradiction, weak synthesis,
  selector mismatch, or shared-state conflict.

Do not convert ChatGPT usage or credits into API-dollar cost unless the product
provides an authoritative conversion. Never substitute token use or
wall-clock speed for cost. Report unavailable measurements explicitly.

### Admission and stopping rules

Admit multi-agent execution only when at least two workstreams can proceed
independently, outputs and ownership can be specified before launch, and the
expected synthesis cost is smaller than the avoided serial work.

Prefer one strong task when work depends on one evolving state, most steps are
sequential, ownership cannot be separated, or the strong baseline already
meets the acceptance target efficiently.

Do not increase worker count, automate fallback, or change the routing rubric
from an anecdotal win. Promote a configuration only after repeated held-out
evidence improves the intended cohort at a declared total budget without an
unacceptable quality, cost, interruption, or integration regression. Re-run
the baseline when model families or material native Codex behavior changes.

## Promotion boundary

The next evidence checkpoint may produce one of four outcomes:

- **retain:** the current rubric predicts acceptable choices;
- **thin:** retain explicit selectors and provenance but remove unsupported
  model-specific prescriptions;
- **revise:** change one bounded admission or routing rule with regression
  coverage; or
- **retire:** use a native Codex primitive directly when Flow adds no durable
  cross-task value.

Only a stable result becomes an ADR. A primary-pilot result alone is not
universal evidence; at least one independent held-out context must challenge
the conclusion before a general package rule is promoted.
