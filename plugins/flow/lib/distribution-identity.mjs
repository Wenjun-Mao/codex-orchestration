import { CliError, requireText } from "./core.mjs";

const CODEX_CACHEBUSTER = /^\d{14}$/;

function version(value, label) {
  return requireText(value, label, { max: 128 });
}

function cachebusterVersion(releaseVersion) {
  return new RegExp(`^${releaseVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\+codex\\.(\\d{14})$`);
}

/**
 * Source trees are release authorities, so their package and plugin metadata
 * must carry the exact semantic release identity without distribution data.
 */
export function assertExactSourceReleaseIdentity({ packageVersion, pluginVersion, expectedVersion }) {
  const expected = version(expectedVersion, "expected source package version");
  if (
    version(packageVersion, "source package version") !== expected
    || version(pluginVersion, "source plugin version") !== expected
  ) throw new CliError(`Source package and plugin metadata must exactly match version ${expected}`);
  return { package_version: expected, plugin_version: expected };
}

/**
 * The plugin updater stamps only its manifest with +codex.YYYYMMDDhhmmss.
 * Preserve that raw value as distribution evidence while keeping the package
 * and runtime namespace anchored to the semantic release identity.
 */
export function assertInstalledDistributionIdentity({ packageVersion, pluginVersion, expectedVersion }) {
  const expected = version(expectedVersion, "expected installed package version");
  const packageValue = version(packageVersion, "installed package version");
  const pluginValue = version(pluginVersion, "installed plugin version");
  if (packageValue !== expected) {
    throw new CliError(`Installed package metadata must exactly match version ${expected}`);
  }
  if (pluginValue === expected) {
    return {
      package_version: packageValue,
      plugin_version: pluginValue,
      cachebuster: null,
    };
  }
  const match = cachebusterVersion(expected).exec(pluginValue);
  if (match === null || !CODEX_CACHEBUSTER.test(match[1])) {
    throw new CliError(
      `Installed plugin metadata must be ${expected} or ${expected}+codex.YYYYMMDDhhmmss`,
    );
  }
  return {
    package_version: packageValue,
    plugin_version: pluginValue,
    cachebuster: match[1],
  };
}
