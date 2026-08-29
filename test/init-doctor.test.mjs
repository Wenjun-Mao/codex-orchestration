import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import test from "node:test";
import {
  assertSuccess,
  createGitFixture,
  initializeFixture,
  removeFixture,
  runLegacyCli,
} from "./helpers.mjs";
import { PACKAGE_VERSION } from "../lib/core.mjs";
import { CODEX_FLOW_STATE_NAMESPACE, discoverGit } from "../lib/git.mjs";

async function snapshotFiles(root) {
  const snapshot = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const info = await lstat(path, { bigint: true });
        const contents = await readFile(path);
        snapshot[relative(root, path)] = {
          hash: createHash("sha256").update(contents).digest("hex"),
          mtime_ns: info.mtimeNs.toString(),
        };
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("init preserves a Python repository and installs a pinned runtime idempotently", async () => {
  const root = await createGitFixture("codex-flow-python-");
  try {
    const originalAgents = "# Python Conventions\n\nUse uv and pytest.\n";
    await writeFile(resolve(root, "AGENTS.md"), originalAgents, "utf8");
    await writeFile(resolve(root, "pyproject.toml"), "[project]\nname = \"fixture\"\nversion = \"0.0.0\"\n", "utf8");

    const first = initializeFixture([
      "--model", "gpt-5.5",
      "--reasoning-effort", "high",
      "--max-concurrency", "3",
    ], { cwd: root }).applied;
    const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    assert.ok(agents.startsWith(originalAgents.trimEnd()));
    assert.equal((agents.match(/codex-flow:start/g) ?? []).length, 1);
    assert.equal((agents.match(/codex-flow:end/g) ?? []).length, 1);
    const config = JSON.parse(await readFile(resolve(root, ".codex/orchestration/project.json"), "utf8"));
    assert.equal(config.default_model, "gpt-5.5");
    assert.equal(config.default_reasoning_effort, "high");
    assert.equal(config.max_parallel_executors, 3);
    await readFile(resolve(root, ".codex/orchestration/bin/codex-flow.mjs"));
    await assert.rejects(readFile(resolve(root, "package.json")), { code: "ENOENT" });

    const beforeCheck = await snapshotFiles(root);
    assertSuccess(runLegacyCli(["init", "--check"], { cwd: root }), "init check");
    assert.deepEqual(await snapshotFiles(root), beforeCheck);
    const second = initializeFixture([], { cwd: root }).applied;
    assert.equal(JSON.parse(second.stdout).changed, false);

    const doctor = runLegacyCli(["doctor", "--json"], {
      cwd: root,
      env: { CODEX_FLOW_CODEX_BIN: resolve(root, "missing-codex") },
    });
    assertSuccess(doctor, "doctor");
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.project.project_id, root.split("/").at(-1));
    assert.equal(report.thread_creation, "runtime-probe-required");
  } finally {
    await removeFixture(root);
  }
});

test("sync removes obsolete manifest-owned files and preserves project configuration", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture(["--project-id", "obsolete-fixture"], { cwd: root });
    const runtimeRoot = resolve(root, ".codex/orchestration");
    const obsoletePath = resolve(runtimeRoot, "lib/obsolete.mjs");
    const obsoleteContents = "export const retired = true;\n";
    await writeFile(obsoletePath, obsoleteContents, "utf8");
    const manifestPath = resolve(runtimeRoot, "version.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files["lib/obsolete.mjs"] = createHash("sha256")
      .update(obsoleteContents)
      .digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const configBefore = await readFile(resolve(runtimeRoot, "project.json"), "utf8");

    assertSuccess(runLegacyCli(["sync"], { cwd: root }), "obsolete-file sync");
    await assert.rejects(readFile(obsoletePath), { code: "ENOENT" });
    assert.equal(await readFile(resolve(runtimeRoot, "project.json"), "utf8"), configBefore);
    assertSuccess(runLegacyCli(["sync", "--check"], { cwd: root }), "post-upgrade check");
  } finally {
    await removeFixture(root);
  }
});

test("sync refuses locally modified managed runtime files", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture([], { cwd: root });
    const managed = resolve(root, ".codex/orchestration/lib/core.mjs");
    await writeFile(managed, "// local drift\n", "utf8");
    const refused = runLegacyCli(["sync"], { cwd: root });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /local drift/);
    assertSuccess(runLegacyCli(["sync", "--force"], { cwd: root }), "forced reviewed sync");
    assert.doesNotMatch(await readFile(managed, "utf8"), /local drift/);
  } finally {
    await removeFixture(root);
  }
});

test("v0.5 rejects older project configuration instead of migrating it", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture([], { cwd: root });
    const configPath = resolve(root, ".codex/orchestration/project.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const old = { ...config, schema_version: 3 };
    delete old.git_lifecycle;
    const oldBytes = `${JSON.stringify(old, null, 2)}\n`;
    await writeFile(configPath, oldBytes, "utf8");
    const sync = runLegacyCli(["sync"], { cwd: root });
    assert.notEqual(sync.status, 0);
    assert.match(sync.stderr, /fresh schema 4 initialization/);
    const plan = runLegacyCli(["init", "--plan", "--json"], { cwd: root });
    assert.notEqual(plan.status, 0);
    assert.match(plan.stderr, /fresh schema 4 initialization/);
    assert.equal(await readFile(configPath, "utf8"), oldBytes);
  } finally {
    await removeFixture(root);
  }
});

test("v0.5.2-dev.0 preserves retained v0.5.1 state in its exact-release namespace", async () => {
  const root = await createGitFixture("codex-flow-state-v05-");
  try {
    const v04Record = resolve(
      root,
      ".git",
      "codex-flow",
      "v0.4",
      "task-operations",
      "records",
      "incompatible-v03.json",
    );
    const v05Record = resolve(
      root,
      ".git",
      "codex-flow",
      "v0.5",
      "task-operations",
      "records",
      "pre-observation-policy.json",
    );
    const v051Record = resolve(
      root,
      ".git",
      "codex-flow",
      "v0.5.1",
      "callbacks",
      "records",
      "accepted-runtime-state.json",
    );
    await mkdir(resolve(v04Record, ".."), { recursive: true });
    await mkdir(resolve(v05Record, ".."), { recursive: true });
    await mkdir(resolve(v051Record, ".."), { recursive: true });
    await writeFile(v04Record, "{\"schema_version\":2}\n", "utf8");
    await writeFile(v05Record, "{\"schema_version\":8}\n", "utf8");
    await writeFile(v051Record, "{\"schema_version\":2,\"accepted\":\"v0.5.1\"}\n", "utf8");
    const v051StateRoot = resolve(root, ".git", "codex-flow", "v0.5.1");
    const retainedV051State = await snapshotFiles(v051StateRoot);

    initializeFixture([], { cwd: root });
    const context = discoverGit(root);
    assert.equal(context.stateRoot, resolve(context.commonDir, "codex-flow", CODEX_FLOW_STATE_NAMESPACE));
    assert.equal(await readFile(v04Record, "utf8"), "{\"schema_version\":2}\n");
    assert.equal(await readFile(v05Record, "utf8"), "{\"schema_version\":8}\n");
    assert.deepEqual(await snapshotFiles(v051StateRoot), retainedV051State);
    const doctor = runLegacyCli(["doctor", "--json"], { cwd: root });
    assertSuccess(doctor, "current-version namespaced doctor");
    assert.equal(JSON.parse(doctor.stdout).ok, true);
    assert.deepEqual(await snapshotFiles(v051StateRoot), retainedV051State);
  } finally {
    await removeFixture(root);
  }
});

test("init fails closed on malformed AGENTS managed markers", async () => {
  const root = await createGitFixture();
  try {
    await writeFile(resolve(root, "AGENTS.md"), "<!-- codex-flow:start v0.0.1 -->\n", "utf8");
    const result = runLegacyCli(["init", "--plan"], { cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /malformed or duplicate/);
  } finally {
    await removeFixture(root);
  }
});

test("init fails closed when AGENTS managed markers are reversed", async () => {
  const root = await createGitFixture();
  try {
    await writeFile(resolve(root, "AGENTS.md"), [
      "# Existing guidance",
      "<!-- codex-flow:end -->",
      "keep this text",
      "<!-- codex-flow:start v0.0.1 -->",
      "",
    ].join("\n"), "utf8");
    const before = await readFile(resolve(root, "AGENTS.md"), "utf8");
    const result = runLegacyCli(["init", "--plan"], { cwd: root });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /malformed or duplicate/);
    assert.equal(await readFile(resolve(root, "AGENTS.md"), "utf8"), before);
  } finally {
    await removeFixture(root);
  }
});

test("project defaults can be changed after initialization and resolved per task", async () => {
  const root = await createGitFixture();
  try {
    initializeFixture([], { cwd: root });
    const changed = runLegacyCli([
      "config", "set",
      "--model", "gpt-5.6-luna",
      "--reasoning-effort", "medium",
      "--max-concurrency", "4",
      "--json",
    ], { cwd: root });
    assertSuccess(changed, "config set");
    assert.deepEqual(JSON.parse(changed.stdout), {
      schema_version: 4,
      project_id: root.split("/").at(-1),
      max_parallel_executors: 4,
      default_model: "gpt-5.6-luna",
      default_reasoning_effort: "medium",
      agents_integration: { mode: "managed" },
      git_lifecycle: {
        protected_branches: ["main", "master"],
        warn_at: 5,
        block_at: 10,
      },
    });

    const packetPath = resolve(root, "packet.json");
    const packet = JSON.parse(await readFile(resolve(import.meta.dirname, "../examples/task-packet.json"), "utf8"));
    packet.model = null;
    packet.reasoning_effort = null;
    await writeFile(packetPath, JSON.stringify(packet), "utf8");
    const rendered = runLegacyCli(["task", "packet", "render", packetPath, "--json"], { cwd: root });
    assertSuccess(rendered, "resolved task packet");
    assert.equal(JSON.parse(rendered.stdout).model, "gpt-5.6-luna");
    assert.equal(JSON.parse(rendered.stdout).reasoning_effort, "medium");
    const perTaskHostDefault = runLegacyCli([
      "task", "packet", "render", packetPath,
      "--model", "host-default",
      "--reasoning-effort", "host-default",
      "--json",
    ], { cwd: root });
    assertSuccess(perTaskHostDefault, "per-task host default");
    assert.equal(JSON.parse(perTaskHostDefault.stdout).model, null);
    assert.equal(JSON.parse(perTaskHostDefault.stdout).reasoning_effort, null);

    assertSuccess(runLegacyCli([
      "config", "set", "--model", "host-default", "--reasoning-effort", "host-default",
    ], { cwd: root }), "host-default config");
    const shown = runLegacyCli(["config", "show", "--json"], { cwd: root });
    assertSuccess(shown, "config show");
    assert.equal(JSON.parse(shown.stdout).default_model, null);
    assert.equal(JSON.parse(shown.stdout).default_reasoning_effort, null);
  } finally {
    await removeFixture(root);
  }
});
