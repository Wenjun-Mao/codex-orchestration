import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function git(root, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: null,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(Buffer.from(result.stderr ?? []).toString("utf8").trim() || `Git command failed: git ${args.join(" ")}`);
  }
  return result;
}

function lines(buffer) {
  return Buffer.from(buffer ?? []).toString("utf8").split("\0").filter(Boolean);
}

function packagePathspecs(packageMetadata) {
  if (!Array.isArray(packageMetadata.files) || packageMetadata.files.length === 0) {
    throw new Error("Package release identity requires a nonempty package.json files allowlist");
  }
  const paths = new Set(["package.json"]);
  for (const value of packageMetadata.files) {
    if (typeof value !== "string" || value === "" || value.startsWith("/") || value.includes("..") || /[*?[]/.test(value)) {
      throw new Error(`Unsupported package.json files entry for release identity: ${String(value)}`);
    }
    paths.add(value);
  }
  return [...paths];
}

function untrackedPaths(root, pathspecs) {
  const ordinary = git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs]);
  const ignored = git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...pathspecs]);
  return [...new Set([...lines(ordinary.stdout), ...lines(ignored.stdout)])].sort();
}

/**
 * Reject a source checkout that would package different paths under a version
 * already claimed by an annotated release tag. A package outside a Git source
 * checkout has no release-tag authority to compare and is intentionally skipped.
 */
export function validateReleaseIdentity(root, packageMetadata) {
  const version = packageMetadata?.version;
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error("Package release identity requires a valid semantic package version");
  }

  const checkout = git(root, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (
    checkout.status !== 0
    || realpathSync(resolve(checkout.stdout.toString("utf8").trim())) !== realpathSync(resolve(root))
  ) {
    return { tag: null, status: "not-source-checkout" };
  }

  const tag = `v${version}`;
  const tagType = git(root, ["cat-file", "-t", `refs/tags/${tag}`], { allowFailure: true });
  if (tagType.status !== 0) return { tag: null, status: "unreleased" };
  if (tagType.stdout.toString("utf8").trim() !== "tag") {
    throw new Error(`Release tag ${tag} must be annotated before it can protect package version ${version}`);
  }

  const tagCommit = git(root, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`])
    .stdout.toString("utf8").trim();
  const pathspecs = packagePathspecs(packageMetadata);
  const changed = lines(git(root, [
    "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", tag, "--", ...pathspecs,
  ]).stdout).sort();
  const untracked = untrackedPaths(root, pathspecs);
  if (changed.length > 0 || untracked.length > 0) {
    const details = [
      ...changed.map((path) => `tracked:${path}`),
      ...untracked.map((path) => `untracked:${path}`),
    ];
    throw new Error(
      `Package version ${version} is already protected by annotated tag ${tag}; packaged paths differ from that release (${details.join(", ")}). Bump the exact package version before packaging new source.`,
    );
  }
  return { tag, tag_commit: tagCommit, status: "matches-tag" };
}
