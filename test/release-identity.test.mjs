import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { validateReleaseIdentity } from "../scripts/release-identity.mjs";

const packageMetadata = {
  version: "1.2.3",
  files: ["lib/"],
  main: "./entry/main.mjs",
  bin: { "release-identity-fixture": "./entry/bin.mjs" },
};

async function createReleasedFixture({ prepack } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-release-identity-"));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  await mkdir(resolve(root, "entry"));
  await mkdir(resolve(root, "lib"));
  await writeFile(resolve(root, "package.json"), `${JSON.stringify({
    name: "release-identity-fixture",
    ...packageMetadata,
    ...(prepack ? { scripts: { prepack } } : {}),
  })}\n`, "utf8");
  await writeFile(resolve(root, "README.md"), "release fixture\n", "utf8");
  await writeFile(resolve(root, "entry", "main.mjs"), "export const main = true;\n", "utf8");
  await writeFile(resolve(root, "entry", "bin.mjs"), "#!/usr/bin/env node\n", "utf8");
  await writeFile(resolve(root, "lib", "core.mjs"), "export const value = 1;\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "release fixture"], { cwd: root });
  execFileSync("git", ["tag", "-a", "v1.2.3", "-m", "release fixture"], { cwd: root });
  return root;
}

function packedPaths(root, { ignoreScripts = true } = {}) {
  const result = spawnSync("npm", [
    "pack",
    "--dry-run",
    "--json",
    ...(ignoreScripts ? ["--ignore-scripts"] : []),
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout)[0].files.map((file) => file.path);
}

test("release identity accepts an unchanged annotated exact-version tag", async () => {
  const root = await createReleasedFixture();
  try {
    assert.deepEqual(validateReleaseIdentity(root, packageMetadata), {
      tag: "v1.2.3",
      tag_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      status: "matches-tag",
    });
    const packaged = packedPaths(root);
    for (const path of ["package.json", "README.md", "lib/core.mjs"]) {
      assert.ok(packaged.includes(path), `npm pack must include ${path}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity rejects a committed post-tag packaged change", async () => {
  const root = await createReleasedFixture();
  try {
    await writeFile(resolve(root, "lib", "core.mjs"), "export const value = 2;\n", "utf8");
    execFileSync("git", ["add", "lib/core.mjs"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "post-tag package change"], { cwd: root });
    assert.throws(() => validateReleaseIdentity(root, packageMetadata), /tracked:lib\/core\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity rejects ordinary and ignored automatic root package files", async () => {
  const root = await createReleasedFixture();
  try {
    await writeFile(resolve(root, ".gitignore"), "LiCeNcE.md\n", "utf8");
    await writeFile(resolve(root, "COPYING"), "untracked package copying\n", "utf8");
    await writeFile(resolve(root, "LiCeNcE.md"), "untracked package license\n", "utf8");
    assert.ok(packedPaths(root).includes("COPYING"));
    assert.ok(packedPaths(root).includes("LiCeNcE.md"));
    assert.throws(
      () => validateReleaseIdentity(root, packageMetadata),
      /untracked:COPYING, untracked:LiCeNcE\.md/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity protects main and bin entrypoints outside the files allowlist", async () => {
  const root = await createReleasedFixture();
  try {
    await writeFile(resolve(root, "entry", "main.mjs"), "export const main = false;\n", "utf8");
    await writeFile(resolve(root, "entry", "bin.mjs"), "#!/usr/bin/env node\nprocess.exit(1);\n", "utf8");
    assert.throws(
      () => validateReleaseIdentity(root, packageMetadata),
      /tracked:entry\/bin\.mjs, tracked:entry\/main\.mjs/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity rejects an untagged stable version", async () => {
  const root = await createReleasedFixture();
  try {
    execFileSync("git", ["tag", "-d", "v1.2.3"], { cwd: root });
    assert.throws(() => validateReleaseIdentity(root, packageMetadata), /requires an annotated exact release tag/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity allows an untagged prerelease development version", async () => {
  const root = await createReleasedFixture();
  try {
    const developmentMetadata = { ...packageMetadata, version: "1.2.4-dev.0" };
    assert.deepEqual(validateReleaseIdentity(root, developmentMetadata), {
      tag: null,
      status: "unreleased-development",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity rejects a lightweight tag that cannot establish release authority", async () => {
  const root = await createReleasedFixture();
  try {
    execFileSync("git", ["tag", "-d", "v1.2.3"], { cwd: root });
    execFileSync("git", ["tag", "v1.2.3"], { cwd: root });
    assert.throws(() => validateReleaseIdentity(root, packageMetadata), /must be annotated/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("direct npm pack runs the release-identity guard before packaging", async () => {
  const root = await createReleasedFixture({
    prepack: `node ${JSON.stringify(resolve(import.meta.dirname, "../scripts/release-identity.mjs"))}`,
  });
  try {
    await writeFile(resolve(root, "lib", "core.mjs"), "export const value = 2;\n", "utf8");
    execFileSync("git", ["add", "lib/core.mjs"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "post-tag package change"], { cwd: root });
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Package version 1\.2\.3 is already protected/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
