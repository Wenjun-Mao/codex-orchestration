import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyInstallationPlan,
  createInstallationPlan,
} from "../lib/installation.mjs";
import { gitSnapshot } from "../lib/git.mjs";
import {
  assertSuccess,
  createGitFixture,
  initializeFixture,
  packageRoot,
  removeFixture,
  runCli,
} from "./helpers.mjs";

function externalArgs() {
  return [
    "--agents-mode", "external",
    "--external-agents-path", "AGENTS.md",
    "--attest-external-agents",
  ];
}

function directOptions(root) {
  const git = gitSnapshot(root);
  return {
    gitRoot: git.root,
    stateRoot: git.stateRoot,
    stateGuardRoot: git.commonDir,
    packageRoot,
    repository: {
      branch: git.branch,
      revision: git.revision,
      cleanliness: git.cleanliness,
    },
  };
}

test("init plan is read-only, reports the full AGENTS delta, and direct unplanned init is refused", async () => {
  const root = await createGitFixture();
  try {
    const agents = `${Array.from({ length: 49 }, (_, index) => `instruction ${index + 1}`).join("\n")}\n`;
    await writeFile(resolve(root, "AGENTS.md"), agents, "utf8");
    const indexPath = resolve(root, ".git", "index");
    const indexBefore = await lstat(indexPath, { bigint: true });

    const planned = runCli(["init", "--plan", "--json"], { cwd: root });
    assertSuccess(planned, "read-only plan");
    const plan = JSON.parse(planned.stdout);
    assert.equal(plan.applicable, true);
    assert.equal(plan.agents.mode, "managed");
    assert.equal(plan.agents.before_lines, 49);
    assert.ok(plan.agents.after_lines > plan.agents.before_lines);
    assert.ok(plan.operations.some((item) => item.path === "AGENTS.md" && item.action === "update"));
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), agents);
    await assert.rejects(readFile(resolve(root, ".codex", "orchestration", "project.json")), { code: "ENOENT" });
    const indexAfter = await lstat(indexPath, { bigint: true });
    assert.equal(indexAfter.mtimeNs, indexBefore.mtimeNs);

    const unplanned = runCli(["init"], { cwd: root });
    assert.notEqual(unplanned.status, 0);
    assert.match(unplanned.stderr, /requires exactly one/);
  } finally {
    await removeFixture(root);
  }
});

test("setup mode binds installation to its clean dedicated branch", async () => {
  const root = await createGitFixture("codex-flow-setup-mode-");
  try {
    const wrongBranch = runCli(["init", "--plan", "--setup-mode", "existing", "--json"], { cwd: root });
    assert.notEqual(wrongBranch.status, 0);
    const wrongBranchPlan = JSON.parse(wrongBranch.stdout);
    assert.ok(wrongBranchPlan.conflicts.some((item) => item.code === "setup-branch"));
    await assert.rejects(
      readFile(resolve(root, ".codex/orchestration/version.json")),
      { code: "ENOENT" },
    );

    execFileSync("git", ["switch", "-c", "codex/codex-flow-v0.5-adoption"], { cwd: root });
    const cleanPlanResult = runCli(
      ["init", "--plan", "--setup-mode", "existing", "--json"],
      { cwd: root },
    );
    assertSuccess(cleanPlanResult, "clean adoption plan");
    const cleanPlan = JSON.parse(cleanPlanResult.stdout);
    assert.equal(cleanPlan.setup_mode, "existing");

    const dirtyPath = resolve(root, "ongoing.py");
    await writeFile(dirtyPath, "print('ongoing')\n", "utf8");
    const dirtyPlan = runCli(
      ["init", "--plan", "--setup-mode", "existing", "--json"],
      { cwd: root },
    );
    assert.notEqual(dirtyPlan.status, 0);
    assert.ok(JSON.parse(dirtyPlan.stdout).conflicts.some(
      (item) => item.code === "setup-cleanliness",
    ));
    await rm(dirtyPath);

    const omittedMode = runCli(
      ["init", "--apply-plan", cleanPlan.plan_id, "--json"],
      { cwd: root },
    );
    assert.notEqual(omittedMode.status, 0);
    assert.match(omittedMode.stderr, /Installation plan changed/);
    await assert.rejects(
      readFile(resolve(root, ".codex/orchestration/version.json")),
      { code: "ENOENT" },
    );

    assertSuccess(
      runCli(
        [
          "init",
          "--apply-plan",
          cleanPlan.plan_id,
          "--setup-mode",
          "existing",
          "--json",
        ],
        { cwd: root },
      ),
      "adoption apply",
    );
  } finally {
    await removeFixture(root);
  }
});

test("stale install plan is rejected before any planned path changes", async () => {
  const root = await createGitFixture();
  try {
    await writeFile(resolve(root, "AGENTS.md"), "# Initial policy\n", "utf8");
    const planned = runCli(["init", "--plan", "--json"], { cwd: root });
    assertSuccess(planned, "initial plan");
    const plan = JSON.parse(planned.stdout);
    await writeFile(resolve(root, "AGENTS.md"), "# Changed policy\n", "utf8");

    const stale = runCli(["init", "--apply-plan", plan.plan_id], { cwd: root });
    assert.equal(stale.status, 75);
    assert.match(stale.stderr, /Installation plan changed/);
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), "# Changed policy\n");
    await assert.rejects(readFile(resolve(root, ".codex", "orchestration", "project.json")), { code: "ENOENT" });
  } finally {
    await removeFixture(root);
  }
});

test("external AGENTS attestation preserves mature instructions and doctor fails closed on drift", async () => {
  const root = await createGitFixture();
  try {
    const agents = "# Mature repository policy\n\nUse the repository-owned coordinator contract.\n";
    await writeFile(resolve(root, "AGENTS.md"), agents, "utf8");
    const initialized = initializeFixture(externalArgs(), { cwd: root });
    assert.equal(initialized.plan.agents.mode, "external");
    assert.equal(initialized.plan.agents.before_sha256, initialized.plan.agents.after_sha256);
    assert.equal(initialized.plan.operations.some((item) => item.path === "AGENTS.md"), false);
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), agents);
    const config = JSON.parse(await readFile(resolve(root, ".codex/orchestration/project.json"), "utf8"));
    assert.equal(config.agents_integration.mode, "external");
    assert.equal(config.agents_integration.path, "AGENTS.md");
    assert.equal(config.agents_integration.attested, true);

    const doctor = runCli(["doctor", "--json"], { cwd: root });
    assertSuccess(doctor, "external doctor");
    assert.deepEqual(JSON.parse(doctor.stdout).agents_contract, {
      mode: "external",
      status: "verified",
      path: "AGENTS.md",
      contract_version: "1",
    });

    await writeFile(resolve(root, "AGENTS.md"), `${agents}\nNew policy.\n`, "utf8");
    const drifted = runCli(["doctor", "--json"], { cwd: root });
    assert.notEqual(drifted.status, 0);
    assert.match(JSON.parse(drifted.stdout).errors.join("\n"), /re-attestation is required/);
    const unattested = runCli([
      "init", "--plan", "--json",
      "--agents-mode", "external",
      "--external-agents-path", "AGENTS.md",
    ], { cwd: root });
    assert.notEqual(unattested.status, 0);
    assert.ok(JSON.parse(unattested.stdout).conflicts.some((item) => item.code === "external-agents-attestation"));

    initializeFixture(externalArgs(), { cwd: root });
    assertSuccess(runCli(["doctor", "--json"], { cwd: root }), "re-attested doctor");
  } finally {
    await removeFixture(root);
  }
});

test("managed installation can transition transactionally to an external equivalent contract", async () => {
  const root = await createGitFixture();
  try {
    const original = "# Existing orchestration\n\nThe coordinator owns task integration.\n";
    await writeFile(resolve(root, "AGENTS.md"), original, "utf8");
    initializeFixture([], { cwd: root });
    assert.match(await readFile(resolve(root, "AGENTS.md"), "utf8"), /codex-flow:start/);

    const transitioned = initializeFixture(externalArgs(), { cwd: root });
    assert.equal(transitioned.plan.agents.mode, "external");
    assert.ok(transitioned.plan.operations.some((item) => item.path === "AGENTS.md" && item.action === "update"));
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), original);
    assertSuccess(runCli(["doctor", "--json"], { cwd: root }), "transition doctor");
  } finally {
    await removeFixture(root);
  }
});

test("installation rolls back runtime and AGENTS when activation fails", async () => {
  const root = await createGitFixture();
  try {
    const original = "# Existing instructions\n";
    await writeFile(resolve(root, "AGENTS.md"), original, "utf8");
    const options = directOptions(root);
    const plan = await createInstallationPlan(options);
    await assert.rejects(
      applyInstallationPlan(options, plan.plan_id, {
        afterRuntimeActivation() {
          throw new Error("synthetic post-activation failure");
        },
      }),
      /synthetic post-activation failure/,
    );
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), original);
    await assert.rejects(readFile(resolve(root, ".codex", "orchestration", "project.json")), { code: "ENOENT" });
  } finally {
    await removeFixture(root);
  }
});
