# Relay planning: approval completeness and estimated duration

Date: 2026-10-14.
Status: draft for user and external review; not implemented or installed.
Source baseline: `db2975ff053d747def2c904e1ffa89fc31fd2076`.

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
| A plan says “review, then implement” | Can be misread as a human approval checkpoint | Name who reviews, what evidence permits continuation, and whether a human decision is actually required. |
| Handoff or resumption | Planning mentions carrying authority forward | Include the relevant granted authority and outstanding gates in the normal handoff/checkpoint; recover them before asking again. |
| Duration | No explicit default | Estimate the whole effort; no default deadline, cap, or requirement to use all estimated time. |
| Estimate exceeded | Unspecified | Update the forecast and explain the cause; this alone neither ends work nor requires renewed approval. |
| Genuine new authority or native restriction | Existing boundary remains | Ask about the specific uncovered action; continue independent authorized work where useful. |

“Foreseeable” means the dependencies and decisions revealed by proportionate
inspection of this plan, not an exhaustive catalogue of hypothetical operations.
Ordinary source reading or reversible setup already covered by the request must
not acquire a new consent ceremony. Existing human gates remain human gates;
the agent must not relabel one as an internal review to avoid asking.

## Draft skill wording

These excerpts are proposed replacements/additions, not currently active skill
instructions. Review the wording as a connected pair.

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
- Trace the foreseeable path through setup, implementation, integration, verification,
  activation, recovery, and closeout as relevant. Inspect available evidence for required
  access, dependencies, and capabilities. Do not perform unapproved operational changes
  merely to discover whether they need approval.
- Reuse authority already given, including applicable standing task-creation approval.
  In the existing plan, briefly distinguish covered actions, meaningful decisions or
  permissions still needed, and any unavoidable later human/native gates. Name affected
  environments and consequential actions clearly enough for an informed decision;
  do not turn ordinary authorized work into a new approval checklist.
- Resolve foreseeable missing choices and permissions together before execution approval
  when possible. Keep dependent design questions sequential, but do not split one settled
  execution decision into repeated milestone approvals. A review step should identify its
  reviewer, the condition for continuing, and whether it actually needs a human decision;
  preserve human gates the user required.
- Give a rough estimated duration for the complete effort, including relevant setup,
  integration, verification, review fixes, and closeout. Use a range and brief assumptions
  when uncertainty matters; separate execution time from material external waiting.
  If evidence is too weak, say so and identify what would support a useful estimate.
  Default to no time limit. An estimate is a forecast, not a deadline, stopping rule,
  or quota to fill. Add a deadline or cap only when the user supplies or agrees to one;
  keep it distinct from the estimate and preserve the agreed clock across resumptions.
- Maintain one plan for the same scope, updating it rather than creating overlapping versions.
  Save it in the existing plans directory (otherwise `docs/plans/`); brief exploration can stay
  in chat. Record durable decisions as repository conventions require, linking ADRs rather
  than duplicating rationale. Do not add documents merely because another stage was reached.
- Default to serial work on the retained checkout. Explain any useful bounded independent
  review; do not invent parallel writers. Model choice belongs at native dispatch, not in worker briefs.
```

### Brainstorm and Plan: replace the closing paragraphs

```markdown
Present the result for review, clearly separating approval of the design from permission
to execute. When execution approval is needed, make the request cover the described path
to completion and its foreseeable consequential actions, with exclusions and remaining gates
visible. Reuse permission already granted; planning alone grants no execution authority.
Do not require separate design and execution approvals when the user's instruction
already covers both.

Carry the approved scope, relevant standing permissions, unresolved gates, and any explicit
deadline into the implementation handoff. Include the duration estimate as a forecast.
When useful, offer a concise ready-to-send kickoff reflecting these boundaries; proposed
wording is not user approval. After implementation approval, use `direct` when managing
delegated work. This skill does not switch native Plan mode or override its restrictions;
defer file writes when prohibited.
```

The current closing instruction about continuing covered work moves into Direct
below, while planning remains responsible for preparing and handing off authority.
No new kickoff ritual is required if the user has already authorized execution.

### Direct: insert before the numbered manager workflow

```markdown
Use the approved scope, any existing plan, and authority already given. Carry relevant
scope, granted permissions, and remaining human/native gates into worker briefs and the existing
resume checkpoint; preserve standing authorization at its actual scope. Reuse these
on resumption and when reviewing results instead of asking the user to approve again.
Continue covered work through review fixes, verification, activation, recovery, and
closeout as applicable. An internal review is a work step; when its agreed conditions
pass, proceed unless the user required a human decision. Seek new guidance only for
a material unresolved choice, uncovered action, changed scope/risk, or native requirement,
and identify the specific gap. Continue useful independent authorized work meanwhile.

Treat estimated duration as a forecast. Update it when evidence materially changes;
overrunning an estimate alone neither stops execution nor requires new approval.
Finish when the outcome is complete, without filling the estimate with extra work.
Honor user-specified deadlines/caps and native controls; resumption does not reset them.
```

Keep the current explicit-model-selection rule, native permission boundaries,
serial writing, reporting, review, and cleanup instructions. In particular, a
director unable to select a subagent's model must still ask for guidance rather
than automatically inherit an expensive model or do that work itself. General
autonomy does not erase that explicit user requirement. Deliver needs no change
for this proposal: the manager passes relevant authority through its work brief.

## Behavioral checks for the eventual implementation

Use these as review scenarios, not production operations or wording-match tests.
Fresh task evaluation, if useful, must have its own authorized scope. Native tools
and restriction evidence must be real before making claims about their behavior.

| Scenario | Expected observable choice |
| --- | --- |
| User asks only for a plan | Produce the plan and estimate; do not start implementation or create tasks merely because the document describes them. |
| Standing task creation is already approved across the user's work | Carry that authority at its stated scope; no new per-task question. Do not infer permission for unrelated work or override a native restriction. |
| Needed environment setup or service activation is foreseeable but not covered | Surface the concrete affected environment/action before launch, together with other known missing permissions. Do not silently execute it. |
| A local source read or ordinary repair is already within scope | Do it without adding a permission gate just because the plan lists it. |
| Plan calls for an internal design review followed by implementation | Review against the agreed conditions, resolve covered fixes, and proceed; ask the user only if a real remaining choice or authority gap exists. |
| User explicitly reserved approval after that review | Preserve and honor the gate. |
| Worker handoff or resumption after compaction | Recover the relevant actual authority and current constraints from the normal brief/checkpoint; a task transition does not itself reset approval. |
| Three-to-five-hour estimate is exceeded without a new risk/scope issue | Explain and revise the forecast, continue useful authorized work; do not mark the run blocked solely for elapsed time. Finish early if complete. |
| User supplied a real hard cap | Preserve the agreed start/deadline across delegates and resumes, allowing for verification and closeout within it; an estimate does not extend the cap. |
| A new destructive operation, different environment, or unavailable model selector appears | Apply the actual authorization/native boundary and ask about the uncovered action; never invent approval or choose the rejected expensive fallback. |

A successful wording review or isolated scenario is evidence of clarity, not a
guarantee that all future agents comply. Observe subsequent real use for missed
foreseeable approvals and unnecessary repeat questions without demanding a new
logging system or exhaustive benchmark before this small change can proceed.

## Implementation after review

1. Integrate useful review findings and obtain the user's decision on this draft.
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

## External review mandate

Mode recommendation: one **Pro** review. The intended value is independent
reasoning about exact instructions and plausible failure modes. Deep Research
does not currently add material evidence. The next decision is whether to apply
this narrow pair of changes, not whether to build the entire later skill set.

Ask the reviewer to inspect the pinned baseline skills, this proposal, and the
existing authorization decision. GitHub-only access is assumed; local task
histories, screenshots, installed caches, and services are unavailable. The
incident summaries above are the complete supplied evidence about those cases.
The broader design note is context, not another implementation mandate.

Questions worth answering:

- Does this materially improve the existing wording, or would a smaller edit
  achieve the same result? Identify omissions, repetition, or ambiguous authority.
- Does it reduce foreseeable late questions while preserving actual user/native
  boundaries? Test both over-cautious stalling and unjustified execution.
- Is estimated duration clearly useful without becoming false precision, a time
  cap, an approval trigger, or a work quota?
- Does Direct preserve approvals across handoffs and resumes without requiring
  a new ledger, schema, or repeated ceremony? Are planning/Direct responsibilities clear?
- Are the proposed scenarios sufficient for this reversible instruction change?

Return a verdict with exact proposed wording changes where useful, source locators
for consequential findings, and any assumptions or access limits. Improvements
may be deletions or simplifications. Do not manufacture objections, safeguards,
or extra review stages. Explain the concrete benefit and cost of any additional
gate. Distinguish directly inspected facts from inference; proposal acceptance
would not prove runtime compliance.
