import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { validateReleaseIdentity } from "../scripts/release-identity.mjs";

const packageMetadata = {
  version: "1.2.3",
  files: ["lib/", "README.md"],
};

async function createReleasedFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "codex-flow-release-identity-"));
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  await mkdir(resolve(root, "lib"));
  await writeFile(resolve(root, "package.json"), `${JSON.stringify(packageMetadata)}\n`, "utf8");
  await writeFile(resolve(root, "README.md"), "release fixture\n", "utf8");
  await writeFile(resolve(root, "lib", "core.mjs"), "export const value = 1;\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "release fixture"], { cwd: root });
  execFileSync("git", ["tag", "-a", "v1.2.3", "-m", "release fixture"], { cwd: root });
  return root;
}

test("release identity accepts an unchanged annotated exact-version tag", async () => {
  const root = await createReleasedFixture();
  try {
    assert.deepEqual(validateReleaseIdentity(root, packageMetadata), {
      tag: "v1.2.3",
      tag_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      status: "matches-tag",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity rejects tracked packaged changes under an accepted version", async () => {
  const root = await createReleasedFixture();
  try {
    await writeFile(resolve(root, "lib", "core.mjs"), "export const value = 2;\n", "utf8");
    assert.throws(() => validateReleaseIdentity(root, packageMetadata), /tracked:lib\/core\.mjs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release identity rejects untracked packaged paths, including ignored paths", async () => {
  const root = await createReleasedFixture();
  try {
    await writeFile(resolve(root, ".gitignore"), "*.mjs\n", "utf8");
    await writeFile(resolve(root, "lib", "untracked.mjs"), "export const extra = true;\n", "utf8");
    assert.throws(() => validateReleaseIdentity(root, packageMetadata), /untracked:lib\/untracked\.mjs/);
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
