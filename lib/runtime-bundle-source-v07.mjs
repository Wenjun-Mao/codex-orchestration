import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { CliError, sha256 } from "./core.mjs";

async function walkFiles(root) {
  const result = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new CliError(`Runtime bundle source contains a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function targetRelativePath(packageRoot, source) {
  const relativeSource = relative(packageRoot, source).split(sep).join("/");
  if (["bin/", "lib/", "schemas/"].some((prefix) => relativeSource.startsWith(prefix))) {
    return relativeSource;
  }
  if (relativeSource.startsWith("templates/roles/") || relativeSource.startsWith("templates/references/")) {
    return relativeSource.slice("templates/".length);
  }
  throw new CliError(`Unsupported runtime bundle source: ${relativeSource}`);
}

export async function sourceRuntimeBundleFiles(packageRoot) {
  const roots = ["bin", "lib", "schemas", "templates/roles", "templates/references"];
  const files = [];
  for (const root of roots) {
    const sourceRoot = resolve(packageRoot, root);
    for (const source of await walkFiles(sourceRoot)) {
      const contents = await readFile(source);
      files.push({
        source,
        relativePath: targetRelativePath(packageRoot, source),
        contents,
        hash: sha256(contents),
      });
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
