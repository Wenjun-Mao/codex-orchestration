import { isAbsolute } from "node:path";
import { CliError, requireText } from "./core.mjs";

export function validateRepositoryRelativePath(value, label = "path") {
  requireText(value, label, { max: 512 });
  if (
    isAbsolute(value)
    || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new CliError(`${label} must be a normalized repository-relative path using forward slashes`);
  }
  return value;
}

export function normalizeOwnedPath(value, label) {
  const text = requireText(value, label, { max: 512 }).replaceAll("\\", "/").replace(/\/+$/, "");
  if (
    text === "" || text === "." || text.startsWith("/") || isAbsolute(text)
    || /^[A-Za-z]:\//.test(text) || text.split("/").includes("..")
    || /[*?\[\]{}]/.test(text) || text === ".git" || text.startsWith(".git/")
  ) {
    throw new CliError(`${label} must be a bounded repository-relative path without globs or parent traversal`);
  }
  return text.replace(/^\.\//, "");
}
