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
  assert.match(planSkill, /one approved project plan/);
  assert.match(planSkill, /outcome, scope and non-goals, consequential\s+decisions/);
  assert.match(planSkill, /acceptance evidence, execution\s+authority, and escalation conditions/);
  assertIncludes(planSkill, "exact content digest or immutable snapshot");
  assertIncludes(planSkill, "mutable path alone is not approval evidence");
  assertIncludes(planSkill, "does not implement product changes");
  assertIncludes(planSkill, "material change to intent, acceptance, risk, scope, or external authority");
  assertSequence(planSkill, "save and bind the approved plan before dispatch", "give the coordinator");

  assert.match(assignment, /Approved plan/);
  assertIncludes(assignment, "exact content digest or immutable snapshot");
  assertIncludes(assignment, "A linked worktree must not depend on an uncommitted file");
  assertIncludes(assignment, "exactly one recipient and one path");
  assertSequence(assignment, "The plan is saved and bound before dispatch", "coordinator may add");
});

test("director dispatch returns once and cannot become local implementation or babysitting", async () => {
  const [indexSkill, directSkill, directorRole] = await Promise.all([
    source("skills/index/SKILL.md"),
    source("skills/direct/SKILL.md"),
    source("templates/roles/director.md"),
  ]);

  assert.match(indexSkill, /codex-orchestration:plan/);
  assert.match(indexSkill, /Implement the plan/);
  assert.match(indexSkill, /one bounded coordinator dispatch and return/);
  assert.match(directSkill, /codex-orchestration:plan/);
  assertSequence(directSkill, "persist and bind one approved plan revision", "bounded dispatch", "return to strategic conversation");
  assertIncludes(directSkill, "ready, honestly pending, or blocked");
  assertIncludes(directSkill, "provisional creation result is pending evidence");
  assertIncludes(directSkill, "do not retry creation or enter a lookup loop");
  assertIncludes(directSkill, "repeatedly call `wait_threads`");
  assertIncludes(directSkill, "Do not implement the approved plan locally");
  assert.doesNotMatch(directSkill, /wait for the coordinator to finish/);
  assert.doesNotMatch(directSkill, /monitor unchanged progress in a loop/);

  assert.match(directorRole, /goals/);
  assert.match(directorRole, /tradeoffs/);
  assert.match(directorRole, /acceptance/);
  assert.match(directorRole, /reporting recipient\/path/);
  assertIncludes(directorRole, "dispatch the coordinator once");
  assertIncludes(directorRole, "Do not implement locally");
  assertIncludes(directorRole, "repeatedly call `wait_threads`");
});

test("coordinator and result briefs preserve role authority and one complete report", async () => {
  const [coordinateSkill, coordinatorRole, assignment] = await Promise.all([
    source("skills/coordinate/SKILL.md"),
    source("templates/roles/coordinator.md"),
    source("templates/references/assignment-and-reporting.md"),
  ]);

  for (const contract of [coordinateSkill, coordinatorRole]) {
    assertIncludes(contract, "approved plan");
    assert.ok(
      normalized(contract).includes("initial assignment")
      || normalized(contract).includes("full assignment"),
      "Expected an initial or full assignment contract",
    );
    assert.ok(
      normalized(contract).includes("technical detail")
      || normalized(contract).includes("technical breakdown")
      || normalized(contract).includes("technical work")
      || normalized(contract).includes("implementation detail"),
      "Expected technical detail or breakdown guidance",
    );
    assertIncludes(contract, "material change");
    assertIncludes(contract, "director/user");
  }
  assertIncludes(coordinateSkill, "full assignment");
  assertIncludes(coordinateSkill, "one complete result");
  assertIncludes(coordinateSkill, "exactly one named recipient/path");
  assertIncludes(coordinateSkill, "result is quiet and non-interrupting");
  assertIncludes(coordinatorRole, "quiet journal result");
  assertIncludes(coordinatorRole, "executor waiting, progress management, recovery, verification");
  assertIncludes(assignment, "Write one complete final report");
  assertIncludes(assignment, "Result or receipt delivery is not acceptance");
  assertIncludes(assignment, "Next decision");
});

test("planning and dispatch contracts do not promote executor authority", async () => {
  const [planSkill, directSkill, coordinateSkill, executorRole] = await Promise.all([
    source("skills/plan/SKILL.md"),
    source("skills/direct/SKILL.md"),
    source("skills/coordinate/SKILL.md"),
    source("templates/roles/executor.md"),
  ]);

  assertIncludes(planSkill, "coordinator's technical execution");
  assertIncludes(directSkill, "The coordinator owns executor waiting");
  assertIncludes(coordinateSkill, "A coordinator is allowed to orchestrate");
  assertIncludes(coordinateSkill, "executor contract must not be relabeled");
  assertIncludes(executorRole, "Do not appoint a coordinator");
  assertIncludes(executorRole, "broaden ownership");
  assertIncludes(executorRole, "terminal-receipt-v4");
});
