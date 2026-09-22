import { spawnSync } from "node:child_process";
import { CliError, requireText } from "./core.mjs";
import { normalizeOwnedPath } from "./repository-paths.mjs";

const COMMIT = /^[0-9a-f]{40,64}$/;

function git(repositoryPath, args, label, allowedStatuses = [0]) {
  const result = spawnSync("git", args, {
    cwd: repositoryPath,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowedStatuses.includes(result.status)) {
    throw new CliError(String(result.stderr || result.stdout).trim() || label, 73);
  }
  return result.stdout;
}

function commit(value, label) {
  const result = requireText(value, label, { min: 40, max: 64 });
  if (!COMMIT.test(result)) throw new CliError(`${label} must be a concrete Git commit`, 73);
  return result;
}

function isAncestor(repositoryPath, ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: repositoryPath,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (![0, 1].includes(result.status)) {
    throw new CliError(String(result.stderr || result.stdout).trim() || "Git ancestry inspection failed", 73);
  }
  return result.status === 0;
}

function reachableCommitsList(repositoryPath, baseline, finalRevision) {
  if (baseline === finalRevision) return [];
  if (!isAncestor(repositoryPath, baseline, finalRevision)) {
    throw new CliError("Committed write scope final revision does not descend from its baseline", 73);
  }
  return git(
    repositoryPath,
    ["rev-list", "--reverse", `${baseline}..${finalRevision}`],
    "Committed write scope history inspection failed",
  ).trim().split("\n").filter(Boolean);
}

function parents(repositoryPath, revision) {
  return git(
    repositoryPath,
    ["show", "-s", "--format=%P", revision],
    "Committed write scope parent inspection failed",
  ).trim().split(/\s+/).filter(Boolean);
}

function changedPaths(repositoryPath, parent, revision) {
  const output = git(
    repositoryPath,
    ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "-M", parent, revision],
    "Committed write scope path inspection failed",
  );
  const fields = output.split("\0").filter((entry) => entry !== "");
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (/^[RC][0-9]+$/.test(status)) {
      paths.push(fields[index++], fields[index++]);
    } else {
      paths.push(fields[index++]);
    }
  }
  return [...new Set(paths.map((path) => normalizeOwnedPath(path, "committed path")))].sort();
}

function pathCovered(path, fences) {
  return fences.some((fence) => path === fence || path.startsWith(`${fence}/`));
}

function assertPathsCovered(paths, fences, detail) {
  const uncovered = paths.find((path) => !pathCovered(path, fences));
  if (uncovered !== undefined) {
    throw new CliError(`Committed write scope violation (${detail}): ${uncovered}`, 73);
  }
}

function commitsInRange(repositoryPath, baseline, finalRevision) {
  if (!isAncestor(repositoryPath, baseline, finalRevision)) return new Set();
  return new Set(reachableCommitsList(repositoryPath, baseline, finalRevision));
}

function reachableCommits(repositoryPath, baseline, tip) {
  if (!isAncestor(repositoryPath, baseline, tip)) return new Set();
  return new Set(git(
    repositoryPath,
    ["rev-list", "--reverse", `${baseline}..${tip}`],
    "Integrated child history inspection failed",
  ).trim().split("\n").filter(Boolean));
}

function patchId(repositoryPath, revision) {
  if (parents(repositoryPath, revision).length !== 1) return null;
  const patch = spawnSync("git", ["show", "--pretty=format:", "--no-ext-diff", "--binary", revision], {
    cwd: repositoryPath,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (patch.status !== 0) throw new CliError("Integrated child patch inspection failed", 73);
  const result = spawnSync("git", ["patch-id", "--stable"], {
    cwd: repositoryPath,
    input: patch.stdout,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) throw new CliError("Integrated child patch identity failed", 73);
  return result.stdout.trim().split(/\s+/, 1)[0] || null;
}

function automaticMerge(repositoryPath, revision, revisionParents) {
  if (revisionParents.length !== 2) return false;
  const merge = spawnSync("git", ["merge-tree", "--write-tree", revisionParents[0], revisionParents[1]], {
    cwd: repositoryPath,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (merge.status !== 0) return false;
  const expectedTree = merge.stdout.trim().split("\n", 1)[0];
  const actualTree = git(repositoryPath, ["show", "-s", "--format=%T", revision], "Merge tree inspection failed").trim();
  return expectedTree === actualTree;
}

function integrationAuthority(repositoryPath, integration) {
  const executorBaseline = git(
    repositoryPath,
    ["merge-base", integration.prepared_main_tip, integration.executor_tip],
    "Integrated child baseline inspection failed",
  ).trim();
  commit(executorBaseline, "integrated child baseline");
  const exactCommits = reachableCommits(
    repositoryPath,
    executorBaseline,
    integration.executor_tip,
  );
  const patchIds = new Set([...exactCommits].map((revision) => patchId(repositoryPath, revision)).filter(Boolean));
  return {
    ...integration,
    exactCommits,
    patchIds,
    reconciliationCommits: commitsInRange(
      repositoryPath,
      integration.prepared_main_tip,
      integration.reconciled_main_tip,
    ),
  };
}

function childAuthorityForCommit(repositoryPath, revision, revisionParents, integrations) {
  const revisionPatchId = patchId(repositoryPath, revision);
  const candidates = integrations.flatMap((integration) => {
    if (integration.exactCommits.has(revision)) {
      return [{ integration, attribution: "executor-commit" }];
    }
    if (
      integration.reconciliationCommits.has(revision)
      && revisionPatchId !== null
      && integration.patchIds.has(revisionPatchId)
    ) return [{ integration, attribution: "patch-equivalent-main" }];
    if (revision === integration.reconciled_main_tip
      && revisionParents.length === 2
      && isAncestor(repositoryPath, integration.executor_tip, revisionParents[1])
      && automaticMerge(repositoryPath, revision, revisionParents)) {
      return [{ integration, attribution: "automatic-merge" }];
    }
    return [];
  });
  if (candidates.length > 1) {
    throw new CliError(`Committed write scope has ambiguous child integration attribution: ${revision}`, 73);
  }
  return candidates[0] ?? null;
}

/**
 * Validate every reachable committed transition. Child changes are admitted
 * only through exact integration authority; every other transition must belong
 * to one coordinator-work interval and its task write set.
 */
export function assertCommittedWriteScope({
  repositoryPath,
  admissionRevision,
  finalRevision,
  runPathFences,
  coordinatorWorks,
  integrations,
}) {
  const baseline = commit(admissionRevision, "admissionRevision");
  const final = commit(finalRevision, "finalRevision");
  const runFences = runPathFences.map((path) => normalizeOwnedPath(path, "run path fence"));
  const workAuthorities = coordinatorWorks.map((entry) => ({
    ...entry,
    commits: commitsInRange(repositoryPath, entry.baselineRevision, entry.finalRevision),
    writePaths: entry.writePaths.map((path) => normalizeOwnedPath(path, "task write path")),
  }));
  const integrationAuthorities = integrations
    .filter((entry) => ["ancestor", "patch-equivalent"].includes(entry.outcome))
    .map((entry) => ({
      ...integrationAuthority(repositoryPath, entry),
      writePaths: entry.writePaths.map((path) => normalizeOwnedPath(path, "integrated task write path")),
    }));

  for (const revision of reachableCommitsList(repositoryPath, baseline, final)) {
    const revisionParents = parents(repositoryPath, revision);
    if (revisionParents.length === 0) {
      throw new CliError(`Committed write scope cannot attribute a root transition: ${revision}`, 73);
    }
    const paths = changedPaths(repositoryPath, revisionParents[0], revision);
    assertPathsCovered(paths, runFences, `outside admitted run envelope at ${revision}`);
    const child = childAuthorityForCommit(repositoryPath, revision, revisionParents, integrationAuthorities);
    const owners = workAuthorities.filter((entry) => entry.commits.has(revision));
    if (child !== null) {
      if (child.attribution === "patch-equivalent-main" && owners.length > 0) {
        throw new CliError(
          `Committed write scope has ambiguous patch-equivalent coordinator attribution: ${revision}`,
          73,
        );
      }
      assertPathsCovered(
        paths,
        child.integration.writePaths,
        `outside integrated task ${child.integration.taskId} at ${revision}`,
      );
      continue;
    }
    if (owners.length !== 1) {
      const reason = owners.length === 0 ? "unattributed transition" : "ambiguous coordinator attribution";
      throw new CliError(`Committed write scope violation (${reason}): ${revision}`, 73);
    }
    assertPathsCovered(paths, owners[0].writePaths, `outside coordinator task ${owners[0].taskId} at ${revision}`);
  }
  return { status: "valid", admission_revision: baseline, final_revision: final };
}
