import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "..");

async function source(relativePath) {
  return readFile(resolve(packageRoot, relativePath), "utf8");
}

function normalized(sourceText) {
  return sourceText.replace(/\s+/g, " ").trim().toLowerCase();
}

function assertIncludes(sourceText, phrase) {
  assert.ok(
    normalized(sourceText).includes(normalized(phrase)),
    `Expected contract to include: ${phrase}`,
  );
}

function assertSequence(sourceText, ...markers) {
  const text = normalized(sourceText);
  let cursor = -1;
  for (const marker of markers) {
    const position = text.indexOf(marker.toLowerCase(), cursor + 1);
    assert.notEqual(position, -1, `Expected contract marker after position ${cursor}: ${marker}`);
    cursor = position;
  }
}

test("the plan contract binds one approved revision before coordinator dispatch", async () => {
  const planSkill = await source("skills/plan/SKILL.md");
  const assignment = await source("templates/references/assignment-and-reporting.md");

  assert.match(planSkill, /name: plan/);
  assertIncludes(planSkill, "Write one plan containing outcome");
  assertIncludes(planSkill, "scope/non-goals");
  assertIncludes(planSkill, "acceptance evidence");
  assertIncludes(planSkill, "execution authority");
  assertIncludes(planSkill, "Assignment preparation saves a fixed copy");
  assertIncludes(planSkill, "later edits to the source document do not change that assignment");
  assertIncludes(planSkill, "does not authorize implementation");
  assertIncludes(planSkill, "Material changes to scope, acceptance, risk, or external authority");
  assertSequence(planSkill, "After approval", "Assignment preparation saves", "before dispatch");

  assertIncludes(assignment, "Before task creation");
  assertIncludes(assignment, "assignment prepare");
  assertIncludes(assignment, "computes its digest");
  assertIncludes(assignment, "persists its snapshot");
  assertIncludes(assignment, "No commit, manual checksum");
  assertSequence(assignment, "Before task creation", "coordinator later binds its identity");
});

test("director dispatch returns once and cannot become local implementation or babysitting", async () => {
  const [indexSkill, directSkill, directorRole] = await Promise.all([
    source("skills/index/SKILL.md"),
    source("skills/direct/SKILL.md"),
    source("templates/roles/director.md"),
  ]);

  assert.match(indexSkill, /codex-orchestration:plan/);
  assert.match(indexSkill, /Implement the plan/);
  assertIncludes(indexSkill, "dispatch delivery and return");
  assert.match(directSkill, /codex-orchestration:plan/);
  assertSequence(directSkill, "assignment prepare", "Dispatch one coordinator", "return");
  assertIncludes(directSkill, "ready, pending, or blocked");
  assertIncludes(directSkill, "A provisional result does not authorize a retry or lookup loop");
  assertIncludes(directSkill, "Do not poll progress");
  assertIncludes(directSkill, "Do not absorb unfinished delivery");
  assert.doesNotMatch(directSkill, /wait for the coordinator to finish/);
  assert.doesNotMatch(directSkill, /monitor unchanged progress in a loop/);

  assert.match(directorRole, /goals/);
  assert.match(directorRole, /tradeoffs/);
  assert.match(directorRole, /acceptance/);
  assertIncludes(directorRole, "Dispatch delivery and return to discussion");
  assertIncludes(directorRole, "do not take over routine progress monitoring");
  assertIncludes(directorRole, "Local implementation is limited to work explicitly assigned");
});

test("coordinator and result briefs preserve role authority and one complete report", async () => {
  const [coordinateSkill, coordinatorRole, assignment] = await Promise.all([
    source("skills/coordinate/SKILL.md"),
    source("templates/roles/coordinator.md"),
    source("templates/references/assignment-and-reporting.md"),
  ]);

  for (const contract of [coordinateSkill, coordinatorRole]) {
    assert.ok(normalized(contract).includes("assignment"), "Expected assignment authority");
  }
  assertIncludes(coordinateSkill, "prepared plan snapshot");
  assertIncludes(coordinateSkill, "Refine the technical breakdown without rewriting intent");
  assertIncludes(coordinateSkill, "Return material changes");
  assertIncludes(coordinateSkill, "Return one complete final");
  assertIncludes(coordinatorRole, "Own delivery");
  assertIncludes(coordinatorRole, "preserve the route for the complete final result");
  assertIncludes(assignment, "Return one complete final");
  assertIncludes(assignment, "Do not author a second summary");
  assertIncludes(assignment, "Queue acceptance is submission evidence, not actual delivery");
});

test("planning and dispatch contracts do not promote executor authority", async () => {
  const [planSkill, directSkill, coordinateSkill, executorRole] = await Promise.all([
    source("skills/plan/SKILL.md"),
    source("skills/direct/SKILL.md"),
    source("skills/coordinate/SKILL.md"),
    source("templates/roles/executor.md"),
  ]);

  assertIncludes(planSkill, "Do not duplicate the coordinator's execution DAG");
  assertIncludes(directSkill, "The coordinator owns implementation, executor waiting, integration, and release");
  assertIncludes(coordinateSkill, "Own delivery even with zero children");
  assertIncludes(coordinateSkill, "do not relabel an executor contract as local work");
  assertIncludes(executorRole, "Own only the assigned implementation and evidence");
  assertIncludes(executorRole, "Own only the assigned implementation and evidence");
  assertIncludes(executorRole, "terminal-receipt-v4");
});
