import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  admitTaskLaunchGitActivation,
  admitTaskLaunchIdentity,
  createTaskLaunch,
  reconcileTaskLaunch,
  taskLaunchGitActivationDigest,
  taskLaunchIdentityDigest,
  taskLaunchStatus,
  validateTaskLaunch,
} from "../lib/core/task-launch.mjs";
import { sha256, stableStringify } from "../lib/core.mjs";

const BASELINE = "a".repeat(40);
const NOW = "2026-09-04T00:00:00.000Z";
const NONCE = "b".repeat(64);

function coordinatorBinding() {
  const identity = {
    lineage_id: "v09-launch-lineage",
    thread_id: "v09-coordinator-thread",
    generation: 1,
  };
  return { ...identity, binding_digest: sha256(stableStringify(identity)) };
}

function bootstrap() {
  return [
    "# Codex Flow v0.9 task bootstrap",
    "",
    `CODEX_FLOW_LAUNCH_NONCE=${NONCE}`,
    "",
    "Wait for the authenticated release before activating the executor.",
  ].join("\n");
}

function authority(commonDir, overrides = {}) {
  return {
    run_id: "v09-launch-run",
    operation_id: "task-launch-operation-v1",
    release_id: "task-launch-release-v1",
    ready_thread_id: "v09-ready-thread",
    contract_id: "c".repeat(64),
    runtime_context_digest: "d".repeat(64),
    configuration_digest: "e".repeat(64),
    repository_id: "v09-launch-repository",
    common_dir: commonDir,
    coordinator_binding: coordinatorBinding(),
    plan_id: "v09-launch-plan",
    revision_digest: "f".repeat(64),
    task_id: "v09-launch-core",
    task_digest: "1".repeat(64),
    baseline_revision: BASELINE,
    ...overrides,
  };
}

function launchDraft({ commonDir = "/tmp/v09-launch/.git", worktreePath = "/tmp/v09-launch/executor" } = {}) {
  return {
    authority: authority(commonDir),
    expected_initial_turn: {
      launch_nonce: NONCE,
      bootstrap_digest: sha256(bootstrap()),
    },
    expected_git_activation: {
      worktree_path: worktreePath,
      common_dir: commonDir,
      executor_branch: "codex/v09-launch-executor",
      baseline_revision: BASELINE,
    },
    prepared_at: NOW,
  };
}

function identityEvidence(overrides = {}) {
  return {
    thread_id: "v09-ready-thread",
    turn_id: "v09-first-turn",
    turn_index: 1,
    role: "user",
    content: bootstrap(),
    observed_at: "2026-09-04T00:00:01.000Z",
    ...overrides,
  };
}

function gitActivationEvidence({ commonDir, worktreePath, revision = BASELINE, branch = "codex/v09-launch-executor" }) {
  return {
    worktree_path: worktreePath,
    common_dir: commonDir,
    branch,
    revision,
    cleanliness: "clean",
    observed_at: "2026-09-04T00:00:02.000Z",
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function createGitFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-v09-launch-"));
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["config", "user.email", "fixture@example.test"]);
  git(root, ["config", "user.name", "Fixture"]);
  await writeFile(resolve(root, ".gitkeep"), "fixture\n", "utf8");
  git(root, ["add", ".gitkeep"]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return root;
}

function currentActivation(root, worktreePath, branch) {
  return gitActivationEvidence({
    worktreePath,
    commonDir: git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    revision: git(worktreePath, ["rev-parse", "HEAD"]),
    branch: git(worktreePath, ["branch", "--show-current"]) || branch,
  });
}

test("launch identity, Git activation, and lifecycle state are content-addressed", () => {
  const first = createTaskLaunch(launchDraft());
  const later = createTaskLaunch({ ...launchDraft(), prepared_at: "2026-09-04T01:00:00.000Z" });

  assert.match(first.launch_id, /^task-launch-v09-[0-9a-f]{64}$/);
  assert.equal(first.launch_id, later.launch_id, "creation time is not launch authority");
  assert.notEqual(first.state_digest, later.state_digest, "the lifecycle record retains its preparation time");
  assert.equal(first.status, "prepared");
  assert.deepEqual(validateTaskLaunch(first), first);

  const identityAdmitted = admitTaskLaunchIdentity({ launch: first, identity: identityEvidence() });
  assert.equal(identityAdmitted.status, "identity-admitted");
  assert.equal(taskLaunchStatus(identityAdmitted).executor_activation_permitted, false);
  assert.match(taskLaunchIdentityDigest(identityAdmitted), /^[0-9a-f]{64}$/);

  const active = admitTaskLaunchGitActivation({
    launch: identityAdmitted,
    git_activation: gitActivationEvidence({
      commonDir: "/tmp/v09-launch/.git",
      worktreePath: "/tmp/v09-launch/executor",
    }),
  });
  assert.equal(active.status, "active");
  assert.equal(taskLaunchStatus(active).executor_activation_permitted, true);
  assert.match(taskLaunchGitActivationDigest(active), /^[0-9a-f]{64}$/);

  assert.deepEqual(
    admitTaskLaunchIdentity({ launch: active, identity: identityEvidence() }),
    active,
    "an exact first-turn replay converges",
  );
  assert.throws(
    () => admitTaskLaunchIdentity({
      launch: active,
      identity: identityEvidence({ turn_id: "different-first-turn" }),
    }),
    /conflicts with the one-shot admitted identity/,
  );
  assert.throws(
    () => admitTaskLaunchGitActivation({
      launch: active,
      git_activation: gitActivationEvidence({
        commonDir: "/tmp/v09-launch/.git",
        worktreePath: "/tmp/v09-launch/executor",
        branch: "codex/different-branch",
      }),
    }),
    /does not match the expected executor branch/,
  );
  assert.throws(
    () => admitTaskLaunchIdentity({
      launch: first,
      identity: identityEvidence({ content: bootstrap().replace(NONCE, "0".repeat(64)) }),
    }),
    /exact launch nonce marker/,
  );
  assert.throws(
    () => admitTaskLaunchIdentity({
      launch: first,
      identity: identityEvidence({ observed_at: "2026-09-03T23:59:59.000Z" }),
    }),
    /observation predates launch preparation/,
  );
});

test("real Git activation and first-turn identity reconcile in either host-result order", async (t) => {
  const root = await createGitFixture();
  const baseline = git(root, ["rev-parse", "HEAD"]);
  const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const worktreePaths = [];
  t.after(async () => {
    for (const worktreePath of worktreePaths) {
      try {
        git(root, ["worktree", "remove", "--force", worktreePath]);
      } catch {
        // The fixture may fail before Git records the linked worktree.
      }
    }
    await rm(root, { recursive: true, force: true });
  });

  for (const order of ["identity-first", "git-first"]) {
    const worktreePath = resolve(root, `executor-${order}`);
    worktreePaths.push(worktreePath);
    const branch = `codex/v09-${order}`;
    git(root, ["worktree", "add", "--quiet", "--detach", worktreePath, baseline]);
    const draft = launchDraft({ commonDir, worktreePath });
    draft.authority = authority(commonDir, { baseline_revision: baseline });
    draft.expected_git_activation = {
      ...draft.expected_git_activation,
      executor_branch: branch,
      baseline_revision: baseline,
    };
    let launch = createTaskLaunch(draft);
    const identity = identityEvidence({ turn_id: `first-turn-${order}` });

    if (order === "identity-first") {
      launch = reconcileTaskLaunch({ launch, identity });
      assert.equal(launch.status, "identity-admitted");
    }

    git(worktreePath, ["switch", "--quiet", "--no-track", "-c", branch, baseline]);
    const activation = currentActivation(root, worktreePath, branch);
    assert.equal(activation.revision, baseline);
    assert.equal(activation.branch, branch);

    if (order === "git-first") {
      launch = reconcileTaskLaunch({ launch, git_activation: activation });
      assert.equal(launch.status, "git-activated");
      launch = reconcileTaskLaunch({ launch, identity });
    } else {
      launch = reconcileTaskLaunch({ launch, git_activation: activation });
    }

    assert.equal(launch.status, "active");
    assert.equal(taskLaunchStatus(launch).executor_activation_permitted, true);
    assert.equal(launch.git_activation.branch, branch);
  }
});
