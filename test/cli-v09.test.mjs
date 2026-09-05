import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { RUNTIME_DIRECTORY } from "../lib/runtime-context.mjs";
import {
  assertSuccess,
  createGitFixture,
  removeFixture,
  runCli,
} from "./helpers.mjs";

function visibleTask() {
  return {
    task_id: "cli-v09-visible",
    title: "Exercise v0.9 CLI activation",
    execution_kind: "task-thread",
    mode: "write",
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    selector_rationale: "Terra-high is sufficient for this bounded CLI fixture.",
    fork_turns: null,
    dependencies: [],
    read_paths: ["lib"],
    write_paths: ["audit-sentinel/cli-v09.txt"],
    shared_resources: ["cli-v09-resource"],
    primary_outcome: "Prove the v0.9 CLI activation path is wired.",
    causal_question: null,
    cheapest_safe_direct_attempt: "Activate one clean fixture run.",
    instrument_role: "none",
    supporting_follow_up: null,
    supporting_authorization: null,
  };
}

test("v0.9 help exposes launch authority and no retired bootstrap or release commands", () => {
  const help = runCli(["--help"]);
  assertSuccess(help, "top-level help");
  assert.match(help.stdout, /task launch prepare\|attempt\|reconcile/);
  assert.match(help.stdout, /task launch start --run-id/);
  assert.match(help.stdout, /full first-turn assignment/);
  assert.doesNotMatch(help.stdout, /task create|release prepare|resolve-private/);
  assert.doesNotMatch(help.stdout, /v0\.7\.8|v0\.8\.1|bootstrap-only/);

  const scoped = runCli(["task", "launch", "start", "--help"]);
  assertSuccess(scoped, "scoped launch help");
  assert.match(scoped.stdout, /task launch start --run-id/);
  assert.doesNotMatch(scoped.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION|at parseArgs|node:internal/);

  const retired = runCli(["task", "create", "--help"]);
  assertSuccess(retired, "retired scoped help remains non-crashing");
  assert.doesNotMatch(retired.stderr, /ERR_PARSE_ARGS_UNKNOWN_OPTION|at parseArgs|node:internal/);

  const retiredExecution = runCli(["task", "create", "--run-id", "retired-command"]);
  assert.notEqual(retiredExecution.status, 0);
  assert.match(retiredExecution.stderr, /task requires the v0\.9 launch lifecycle/);
  assert.doesNotMatch(retiredExecution.stderr, /node:internal|at main/);
});

test("v0.9 CLI activates a clean run through current launch-era wiring", async (t) => {
  const root = await createGitFixture("codex-flow-cli-v09-");
  const requests = await mkdtemp(resolve(tmpdir(), "codex-flow-cli-v09-requests-"));
  t.after(async () => {
    await Promise.all([
      removeFixture(root),
      rm(requests, { recursive: true, force: true }),
    ]);
  });

  const task = visibleTask();
  const runId = "cli-v09-run";
  const coordinatorThreadId = "cli-v09-coordinator";
  const request = {
    run_id: runId,
    activated_at: new Date().toISOString(),
    runtime: {
      config: { config_id: "cli-v09-config", snapshot: { project_id: "fixture-project" } },
      policy: { policy_id: "cli-v09-policy", snapshot: { routine_callbacks: "journal" } },
      host: { host_id: "local", session_id: "cli-v09-session" },
      lineage: {
        lineage_id: "cli-v09-lineage",
        thread_id: coordinatorThreadId,
        generation: 1,
      },
    },
    workflow: {
      schema_version: 1,
      plan_id: "cli-v09-plan",
      revision: 1,
      parent_revision_digest: null,
      tasks: [task],
    },
    fences: {
      path_fences: task.write_paths,
      resource_fences: task.shared_resources,
      branch_fences: ["codex/cli-v09-visible"],
    },
  };
  const requestPath = resolve(requests, "activation.json");
  await writeFile(requestPath, `${JSON.stringify(request)}\n`, "utf8");

  const activated = runCli([
    "run", "activate", "--run-id", runId, "--file", requestPath, "--json",
  ], {
    cwd: root,
    env: { CODEX_THREAD_ID: coordinatorThreadId },
  });
  assertSuccess(activated, "run activation");
  const result = JSON.parse(activated.stdout);
  assert.equal(result.run.run_id, runId);
  assert.equal(result.coordinator_identity.matched, true);
  assert.match(
    result.runtime_authority.bundle_root,
    new RegExp(`${RUNTIME_DIRECTORY.replaceAll(".", "\\.")}/runtimes/`),
  );

  await stat(resolve(root, ".git", "codex-flow", RUNTIME_DIRECTORY, "runs", "lifecycle.json"));
  const status = runCli(["run", "status", "--run-id", runId, "--json"], { cwd: root });
  assertSuccess(status, "run status");
  assert.equal(JSON.parse(status.stdout).run.run_id, runId);
});
