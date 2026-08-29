import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const AUTOMATIC_ROOT_DOCUMENT = /^(?:readme|copying|licen[cs]e)(?:\..*)?$/i;

function normalizePackagePath(value, field) {
  if (
    typeof value !== "string"
    || value === ""
    || value.startsWith("/")
    || value.includes("\\")
    || /[*?[]/.test(value)
  ) {
    throw new Error(`Unsupported ${field} path for release identity: ${String(value)}`);
  }
  const normalized = value.replace(/^\.\//, "").replace(/\/+$/, "");
  if (
    normalized === ""
    || normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Unsupported ${field} path for release identity: ${String(value)}`);
  }
  return normalized;
}

function packagePathSelector(packageMetadata) {
  if (!Array.isArray(packageMetadata.files) || packageMetadata.files.length === 0) {
    throw new Error("Package release identity requires a nonempty package.json files allowlist");
  }
  const allowlist = packageMetadata.files.map((value) => normalizePackagePath(value, "package.json files entry"));
  const entrypoints = new Set();
  if (packageMetadata.main !== undefined) {
    entrypoints.add(normalizePackagePath(packageMetadata.main, "package.json main entrypoint"));
  }
  if (packageMetadata.bin !== undefined) {
    const binPaths = typeof packageMetadata.bin === "string"
      ? [packageMetadata.bin]
      : packageMetadata.bin && typeof packageMetadata.bin === "object" && !Array.isArray(packageMetadata.bin)
        ? Object.values(packageMetadata.bin)
        : null;
    if (!binPaths) throw new Error("Package release identity requires package.json bin to be a string or object");
    for (const value of binPaths) {
      entrypoints.add(normalizePackagePath(value, "package.json bin entrypoint"));
    }
  }
  return (path) => (
    path === "package.json"
    || (!path.includes("/") && AUTOMATIC_ROOT_DOCUMENT.test(path))
    || allowlist.some((entry) => entry === "." || path === entry || path.startsWith(`${entry}/`))
    || entrypoints.has(path)
  );
}

function untrackedPaths(root, includesPackagePath) {
  const ordinary = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const ignored = git(root, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
  return [...new Set([...lines(ordinary.stdout), ...lines(ignored.stdout)])]
    .filter(includesPackagePath)
    .sort();
}

function isPrerelease(version) {
  return version.split("+", 1)[0].includes("-");
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
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
  if (tagType.status !== 0) {
    if (isPrerelease(version)) return { tag: null, status: "unreleased-development" };
    throw new Error(
      `Package version ${version} requires an annotated exact release tag before packaging stable source.`,
    );
  }
  if (tagType.stdout.toString("utf8").trim() !== "tag") {
    throw new Error(`Release tag ${tag} must be annotated before it can protect package version ${version}`);
  }

  const tagCommit = git(root, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`])
    .stdout.toString("utf8").trim();
  const includesPackagePath = packagePathSelector(packageMetadata);
  const changed = lines(git(root, [
    "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", tag,
  ]).stdout).filter(includesPackagePath).sort();
  const untracked = untrackedPaths(root, includesPackagePath);
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

if (invokedDirectly()) {
  const root = process.cwd();
  const packageMetadata = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  validateReleaseIdentity(root, packageMetadata);
}
