# Relay planning: approval completeness and estimated duration

Created: 2026-10-14. Revised: 2026-10-15 (revision 2).
Status: revised after two external reviews; awaiting user review, not implemented or installed.
Source baseline: `db2975ff053d747def2c904e1ffa89fc31fd2076`.

## Changes in this revision

- Shorten the planning amendment and distinguish sequential design questions from
  a combined request for independent missing permissions.
- Carry relevant task-specific and standing permissions, the duration forecast,
  and any explicitly agreed deadline/cap and its original clock through handoffs.
- Preserve delegated engineering discretion; renewed guidance is for uncovered
  actions, material scope/risk changes, or actual user/native requirements.
- Require explicit agreement for a time limit consistently in both skills.
- Sharpen the review scenarios and keep optional kickoff help without making it
  another approval step. The current model-selection rule stays intact.

## Proposed decision

Strengthen the existing planning and Direct instructions so foreseeable decisions
and permissions are addressed before execution, and granted authority remains
usable through delegation, review, and resumption. Default to an estimated
completion duration with no time limit. A deadline or execution cap applies only
when the user supplies or explicitly agrees to one; native limits still apply.

This is the first improvement in the wider
[planning and strategic-review design](../../../../docs/plans/2026-10-12-planning-grilling-and-strategic-review-notes.md).
It changes instructions, not Relay's reporting runtime. Optional grilling,
brainstorming refinements, strategic review, and timed review invocation follow
later. Keep the current planning skill name for this round, without deciding
against the agreed later rename.

## Evidence and diagnosis

At the source baseline:

- [Brainstorm and Plan](../../skills/brainstorm-and-plan/SKILL.md), section 6 and
  its closing paragraphs, already says to surface execution permissions, carry
  granted authority into the handoff, and avoid renewed milestone approvals.
- [Direct](../../skills/direct/SKILL.md) has no corresponding instruction to
  recover and apply that authority when dispatching, reviewing, or resuming work.
- [Decision 0008](../decisions/0008-reporting-only.md), “End-to-end authorization,”
  already records the intended behavior. The proposal makes that existing
  decision more actionable rather than introducing a new permission system.
- Neither current skill specifies the requested distinction between a duration
  estimate and a time limit.

The user supplied examples of late questions about service activation, isolated
Python environment setup and source access, and moving from a design review into
local implementation. These are summaries of user-provided screenshots, not
audited project traces. They demonstrate interruptions but do not establish
whether the original requests already authorized the actions, whether the host
required a separate approval, or which instructions those tasks loaded.

The source-level gap is therefore partial guidance across planning and execution,
plus an unspecified estimation default. It is not proven that wording alone
caused every incident. The proposed fix belongs in the two skills because the
manager interprets work scope and user authority; Relay's hook only forwards
messages and should not adjudicate permissions.

## Expected behavior

| Situation | Existing guidance or gap | Proposed behavior |
| --- | --- | --- |
| Preparing execution approval | General instruction to surface operational permissions | Inspect the actual route to completion and collect the meaningful missing decisions and permissions before launch. |
| Routine work within granted scope | Planning says not to ask again; Direct is silent | Direct applies existing authority to dispatch, repairs, review fixes, verification, and covered operational steps. |
| An authorized implementation calls for “review, then implement” | Can be misread as a human approval checkpoint | Name who reviews and what permits continuation; passing an internal review does not require a new approval or grant missing authority. |
| Handoff or resumption | Planning mentions carrying authority forward | Preserve relevant task-specific and standing permissions, remaining gates, the forecast, and any agreed deadline/cap and clock in the normal handoff/checkpoint. |
| Duration | No explicit default | Estimate the whole effort; no default deadline, cap, or requirement to use all estimated time. |
| Estimate exceeded | Unspecified | Update the forecast and explain the cause; this alone neither ends work nor requires renewed approval. |
| Genuine new authority, user decision, or native restriction | Existing boundary remains | Ask about the specific gap while preserving engineering discretion; minor implementation discoveries do not automatically require renewed approval. |

“Foreseeable” means the dependencies and decisions revealed by proportionate
inspection of this plan, not an exhaustive catalogue of hypothetical operations.
Ordinary source reading or reversible setup already covered by the request must
not acquire a new consent ceremony. Existing human gates remain human gates;
the agent must not relabel one as an internal review to avoid asking.

## Draft skill wording

These excerpts are proposed replacements/additions, not currently active skill
instructions. Review the wording as a connected pair.

### Brainstorm and Plan: clarify section 3's first bullet

```markdown
- Ask one focused design question at a time, prioritizing unknowns that change scope or design.
```

This preserves the design discussion while allowing section 6 to group independent
execution permissions. No broader brainstorming changes are proposed here.

### Brainstorm and Plan: replace section 6

```markdown
## 6. Write and check the plan

- A handoff-ready plan makes outcome, scope/exclusions, observable acceptance criteria,
  ordered deliverables, relevant files, dependencies, and material risks clear. Distinguish
  facts from assumptions; check requirement coverage and contradictions.
- Resolve choices that change agreed behavior or scope; identify technical decisions left
  to the implementer. Put unresolved feasibility investigations before dependent implementation.
  The implementer should not guess user intent, but should still exercise engineering judgment;
  do not require prewritten implementation/test code for every step.
- Proportionately trace the foreseeable path to completion, including setup, integration,
  verification, activation, recovery, and closeout where relevant. Identify consequential
  actions, affected environments, and required access/capabilities. Reuse relevant granted
  permissions, both task-specific and standing, including applicable task-creation approval;
  distinguish them from missing decisions/permissions and unavoidable later human/native gates.
  Do not add consent steps for covered work or perform unapproved operational changes
  merely to investigate permissions. Keep this context in the existing plan.
- Group independent missing execution permissions in one informed request before launch
  where possible; resolve dependent design choices sequentially. For reviews that control
  continuation, identify the reviewer, continuation condition, and whether a human decision
  is required. Preserve user-required approval gates.
- Give a rough estimated duration for the complete effort, including relevant setup,
  integration, verification, review fixes, and closeout. Use a range and brief assumptions
  when uncertainty matters; separate execution time from material external waiting.
  If evidence is too weak, say so and identify what would support a useful estimate.
  Default to no time limit. An estimate is a forecast, not a deadline, stopping rule,
  or quota to fill. Add a deadline or cap only when the user supplies or explicitly agrees
  to one; keep it distinct from the estimate and preserve its agreed clock across resumptions.
- Maintain one plan for the same scope, updating it rather than creating overlapping versions.
  Save it in the existing plans directory (otherwise `docs/plans/`); brief exploration can stay
  in chat. Record durable decisions as repository conventions require, linking ADRs rather
  than duplicating rationale. Do not add documents merely because another stage was reached.
- Default to serial work on the retained checkout. Explain any useful bounded independent
  review; do not invent parallel writers. Model choice belongs at native dispatch, not in worker briefs.
```

### Brainstorm and Plan: replace the closing paragraphs

```markdown
Present the plan for review, making consequential actions, exclusions, and remaining
gates clear. Planning alone authorizes neither implementation nor task creation; reuse
authority already granted and ask only for missing execution approval. Do not require
separate design and execution approvals when the user's instruction already covers both.

Carry the approved scope, relevant granted permissions (task-specific and standing),
remaining gates, and duration forecast into the implementation handoff. Include any
user-supplied or explicitly agreed deadline/cap and its agreed clock. When useful,
offer a concise kickoff with the relevant authority or approval reminder; drafted wording
is not approval, and already-authorized execution needs no extra kickoff message.
When implementation is authorized, use `direct` when managing delegated work.
This skill does not switch native Plan mode or override its restrictions; defer file
writes when prohibited.
```

The current closing instruction about continuing covered work moves into Direct
below, while planning remains responsible for preparing and handing off authority.
No new kickoff ritual is required if the user has already authorized execution.

### Direct: insert before the numbered manager workflow

```markdown
Use the approved scope, any existing plan, and authority already given. Carry relevant
scope, granted permissions (task-specific and standing), remaining human/native gates,
the duration forecast, and any agreed deadline/cap and clock into worker briefs and the
normal resume checkpoint. Preserve standing authorization at its actual scope. Reuse
this context on resumption and review instead of asking the user to approve again.
Continue covered work through review fixes, verification, activation, recovery, and
closeout as applicable. An internal review is a work step: when its agreed conditions
pass, continue already-authorized work unless a human/native gate remains. Seek new
guidance only for a user decision outside delegated engineering discretion, an action
outside granted authority, a material change to agreed scope/risk, or an explicit user
requirement or native restriction. Identify the specific gap and continue useful
independent authorized work meanwhile. The subagent model-selection rule below still applies.

Treat estimated duration as a forecast. Update it when evidence materially changes;
overrunning an estimate alone neither stops execution nor requires new approval.
Finish when the outcome is complete, without filling the estimate with extra work.
Default to no time limit unless the user supplies or explicitly agrees to one; native
controls still apply. Preserve agreed deadlines/caps and clocks across delegation and resumption.
```

Keep the current explicit-model-selection rule, native permission boundaries,
serial writing, reporting, review, and cleanup instructions. In particular, a
director unable to select a subagent's model must still ask for guidance rather
than automatically inherit an expensive model or do that work itself. General
autonomy does not erase that explicit user requirement. Deliver needs no change
for this proposal: the manager passes relevant authority through its work brief.

## Behavioral checks for the eventual implementation

Use these as review scenarios, not production operations or wording-match tests.
Any fresh-task evaluation must be covered by existing or newly granted authority;
reuse applicable standing approval. Native tools and restriction evidence must be
real before making claims about their behavior.

| Scenario | Expected observable choice |
| --- | --- |
| User asks only for a plan | Produce the plan and estimate; do not start implementation or create tasks merely because the document describes them. |
| Standing task creation is already approved across the user's work | Carry that authority at its stated scope; no new per-task question. Do not infer permission for unrelated work or override a native restriction. |
| A named service activation is foreseeable; compare prior approval for that action/environment with no such approval | When already covered and native controls permit, proceed without a repeat question. When uncovered, collect permission with other known independent gaps before launch. |
| A local source read or ordinary repair is already within scope | Do it without adding a permission gate just because the plan lists it. |
| Execution is already authorized; the plan calls for an internal design review before implementation | Review against the agreed conditions, resolve covered fixes, and proceed unless a real remaining gate applies. A plan merely listing implementation is insufficient authority. |
| User explicitly reserved approval after that review | Preserve and honor the gate. |
| Handoff/resumption includes standing task-creation approval, one-off permission to activate a named service, and an explicitly agreed relative cap with an established start | Preserve all relevant grants and the original clock from the normal brief/checkpoint; do not lose the one-off permission, restart the cap, or ask again merely because the task resumed. |
| Three-to-five-hour estimate is exceeded without a new risk/scope issue | Explain and revise the forecast, continue useful authorized work; do not mark the run blocked solely for elapsed time. Finish early if complete. |
| An implementation discovery changes an approach within delegated discretion; contrast a material change to agreed scope/risk | Resolve the covered technical choice without asking; seek guidance for the material boundary change. |
| The user authorized an operation but a real native requirement still prevents it | Respect the native requirement without claiming user approval was absent or can bypass it. |
| Explicit subagent model selection is unavailable or restricted | Ask for delegation guidance and wait before starting that work; do not inherit the expensive model or silently do the work on the director. |

A successful wording review or isolated scenario is evidence of clarity, not a
guarantee that all future agents comply. Observe subsequent real use for missed
foreseeable approvals and unnecessary repeat questions without demanding a new
logging system or exhaustive benchmark before this small change can proceed.

## Implementation after review

1. Review this revised draft with the user; external findings have been integrated,
   but the user has not yet approved implementation.
2. Apply the agreed planning/Direct wording and amend Decision 0008's existing
   authorization section with the rationale and estimate distinction.
3. Validate both changed skills and the relocated package with established tools;
   review the scenarios above proportionally. Avoid tests that merely search for
   sentences, mandatory live-service tests, or a new approval runtime.
4. Commit and push the implementation round; install from the verified product
   artifact using the existing process. Report source/package verification and
   installation separately. Do not claim behavioral guarantees from static checks.

No runtime, hook, registry, Deliver, model-policy, automation, or live-project
changes are part of this draft. No new skill names are activated in this round.

## External review disposition — 2026-10-15

Two Pro reports were supplied by the user. Both identify their inspected evidence
as the complete original proposal at `0780d87a720a1fabedcbe96ceacf9217e97a0d70`
and the three baseline files linked above at `db2975ff053d747def2c904e1ffa89fc31fd2076`.
Both recommend adoption with small wording revisions and locate the main benefit
in Direct's application of existing authority. Local source review corroborated
their wording findings. Neither report provides behavioral test evidence or
establishes the causes of the screenshot incidents.

The supplied reports remain unchanged in their original attachments. This section
records our synthesis, separately from their text. The original review mandate
and draft remain available in the pinned proposal revision above.

| Disposition | Finding and resolution |
| --- | --- |
| Use | Shorten planning's operational additions and qualify “one focused question” as a design question, permitting grouped independent permission requests. |
| Use | Carry relevant one-off and standing grants, forecasts, and explicit deadlines/caps with their clocks through the ordinary handoff/checkpoint. |
| Use | Restore materiality and delegated discretion in escalation wording; retain the intentional model-selection question-and-wait requirement. |
| Use | Require explicit agreement for limits and say “When implementation is authorized,” avoiding an implied new approval event. |
| Test | Sharpen existing scenarios to contrast the same authorized/uncovered operation, preserve one-off grants and relative caps, and separately exercise engineering discretion, native restrictions, and model selection. These are proposed checks, not completed tests. |
| Discard | Delete optional kickoff help entirely. The user previously requested useful launch/reminder assistance; retain it conditionally without requiring another message or turning drafted wording into authorization. |

Follow-up recommendation: **none**. Another external round is unlikely to improve
this bounded wording decision materially. The next step is the user's review of
this revision, then the scoped implementation if approved. Reopen consultation
only if a consequential unresolved disagreement or new evidence warrants it.
