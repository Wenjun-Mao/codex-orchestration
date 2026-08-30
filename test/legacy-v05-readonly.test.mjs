import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { PACKAGE_VERSION, sha256 } from "../lib/core.mjs";
import { gitSnapshot } from "../lib/git.mjs";
import {
  LEGACY_V05_PACKAGE_VERSION,
  LEGACY_V05_STATE_NAMESPACE,
  createLegacyV05ReadonlyContext,
  readLegacyV05ReadonlySummary,
} from "../lib/legacy-v05-readonly.mjs";
import { createGitFixture, removeFixture } from "./helpers.mjs";

function legacyRoot(snapshot) {
  return resolve(snapshot.commonDir, "codex-flow", LEGACY_V05_STATE_NAMESPACE);
}

async function seedLegacyAuthority(root, { managedContents = "export const accepted = true;\n", agentsContents = "historical authority\n" } = {}) {
  const managedRoot = resolve(root, ".codex", "orchestration");
  await mkdir(resolve(managedRoot, "lib"), { recursive: true });
  await writeFile(resolve(managedRoot, "lib", "legacy-reader.mjs"), managedContents);
  await writeFile(resolve(root, "AGENTS.md"), agentsContents);
  await writeFile(resolve(managedRoot, "version.json"), `${JSON.stringify({
    schema_version: 1,
    package_version: LEGACY_V05_PACKAGE_VERSION,
    files: { "lib/legacy-reader.mjs": sha256(managedContents) },
  }, null, 2)}\n`);
  await writeFile(resolve(managedRoot, "project.json"), `${JSON.stringify({
    schema_version: 4,
    project_id: "legacy-project",
    agents_integration: {
      mode: "external",
      path: "AGENTS.md",
      sha256: sha256(agentsContents),
      contract_version: "1",
    },
  }, null, 2)}\n`);
}

async function seedLegacyState(snapshot) {
  const root = legacyRoot(snapshot);
  await mkdir(resolve(root, "operations"), { recursive: true });
  await writeFile(resolve(root, "operations", "historical.json"), '{"status":"complete"}\n');
  await writeFile(resolve(root, "README.txt"), "preserve this historical state\n");
  return root;
}

test("verifies exact v0.5.1 authority and preserves historical state byte-for-byte", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-readonly-");
  t.after(() => removeFixture(root));
  await seedLegacyAuthority(root);
  const snapshot = gitSnapshot(root);
  const stateRoot = await seedLegacyState(snapshot);
  const beforeState = {
    operations: await readFile(resolve(stateRoot, "operations", "historical.json")),
    readme: await readFile(resolve(stateRoot, "README.txt")),
  };

  const summary = await readLegacyV05ReadonlySummary(snapshot);
  assert.notEqual(PACKAGE_VERSION, LEGACY_V05_PACKAGE_VERSION);
  assert.equal(summary.ok, true);
  assert.equal(summary.mutation_performed, false);
  assert.deepEqual(summary.package_authority, { package: "@wjmao/codex-flow", package_version: "0.5.1" });
  assert.deepEqual(summary.state_authority, { namespace: "v0.5.1", state_root: stateRoot });
  assert.equal(summary.runtime.package_version, "0.5.1");
  assert.deepEqual(summary.runtime.drift, []);
  assert.deepEqual(summary.runtime.unexpected, []);
  assert.equal(summary.agents.status, "verified");
  assert.equal(summary.state_inventory.file_count, 2);
  assert.deepEqual(await readFile(resolve(stateRoot, "operations", "historical.json")), beforeState.operations);
  assert.deepEqual(await readFile(resolve(stateRoot, "README.txt")), beforeState.readme);
});

test("reports managed-file, unexpected-file, and external AGENTS attestation drift", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-drift-");
  t.after(() => removeFixture(root));
  await seedLegacyAuthority(root);
  const snapshot = gitSnapshot(root);
  await seedLegacyState(snapshot);
  const managedRoot = resolve(root, ".codex", "orchestration");
  await writeFile(resolve(managedRoot, "lib", "legacy-reader.mjs"), "drifted\n");
  await writeFile(resolve(managedRoot, "unexpected.txt"), "unowned\n");
  await writeFile(resolve(root, "AGENTS.md"), "attestation drifted\n");

  const summary = await readLegacyV05ReadonlySummary(snapshot);
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.runtime.drift, [{ path: "lib/legacy-reader.mjs", state: "modified" }]);
  assert.deepEqual(summary.runtime.unexpected, ["unexpected.txt"]);
  assert.equal(summary.agents.status, "drifted");
  assert.ok(summary.errors.some((error) => error.includes("managed-file drift")));
  assert.ok(summary.errors.some((error) => error.includes("unowned files")));
  assert.ok(summary.errors.some((error) => error.includes("attestation has drifted")));
});

test("rejects non-v0.5.1 package and state authorities", async (t) => {
  const root = await createGitFixture("codex-flow-legacy-context-");
  t.after(() => removeFixture(root));
  const snapshot = gitSnapshot(root);
  assert.throws(
    () => createLegacyV05ReadonlyContext({ git: snapshot, stateRoot: resolve(snapshot.commonDir, "codex-flow", "v0.6.2") }),
    /state root must be .*v0\.5\.1/,
  );
  assert.throws(
    () => createLegacyV05ReadonlyContext({ git: snapshot, packageVersion: "0.6.2" }),
    /only accepts package version 0\.5\.1/,
  );
});
