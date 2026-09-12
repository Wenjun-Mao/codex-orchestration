import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync, readFileSync, lstatSync, readlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { requireThat } from './store.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');
export function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
}
export function repository(cwd) {
  const checkout = realpathSync(git(cwd, 'rev-parse', '--show-toplevel'));
  const common = realpathSync(resolve(checkout, git(checkout, 'rev-parse', '--git-common-dir')));
  return { checkout, common, root: join(common, 'relay') };
}
export function snapshot(repo) {
  const paths = git(repo, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const untracked = paths.map(path => {
    const full = join(repo, path);
    const stat = lstatSync(full);
    return [path, stat.mode, digest(stat.isSymbolicLink() ? readlinkSync(full) : readFileSync(full))];
  });
  return {
    head: git(repo, 'rev-parse', 'HEAD'),
    branch: git(repo, 'symbolic-ref', '--short', 'HEAD'),
    status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
    refs: git(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
    index: git(repo, 'ls-files', '--stage', '-z'),
    tracked: digest(git(repo, 'diff', 'HEAD', '--binary', '--no-ext-diff')),
    untracked,
  };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export function clean(repo, branch, head) {
  const value = snapshot(repo);
  requireThat(value.status === '', 'Source is dirty; preserve it and resolve explicitly');
  requireThat(value.branch === branch, 'Selected branch changed');
  if (head) requireThat(value.head === head, 'Checkpoint drift; explicit recovery required');
  return value;
}
export function validateScope(scope) {
  requireThat(Array.isArray(scope) && scope.length > 0, 'At least one exact path or directory/ scope is required');
  for (const path of scope) requireThat(typeof path === 'string' && path.length && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\') && !/[\0\n*?]/.test(path), 'Scope must contain repository-relative literal paths or directory/ prefixes');
  return scope;
}
export function inScope(path, scope) { return scope.some(item => path === item || (item.endsWith('/') && path.startsWith(item))); }
export function validateChecks(checks) {
  requireThat(Array.isArray(checks) && checks.length > 0, 'Provide at least one check argv array');
  for (const argv of checks) requireThat(Array.isArray(argv) && argv.length > 0 && argv.every(x => typeof x === 'string' && x.length > 0), 'Checks use nonempty argv arrays, never PASS assertions');
  return checks;
}
export function inspectResult(repo, baseline, scope, branch) {
  const state = clean(repo, branch);
  git(repo, 'merge-base', '--is-ancestor', baseline, state.head);
  const commits = git(repo, 'rev-list', '--reverse', `${baseline}..${state.head}`).split('\n').filter(Boolean);
  for (const commit of commits) {
    // Diff every parent, not just the final net delta; reverted violations still fail.
    const paths = git(repo, 'diff-tree', '--root', '-m', '--no-commit-id', '--name-only', '-r', '-z', '--no-renames', commit).split('\0').filter(Boolean);
    requireThat(paths.every(path => inScope(path, scope)), `Scope violation in commit ${commit}`);
  }
  return { revision: state.head, baseline, commits };
}
export function runChecks(repo, result, checks, branch) {
  const before = clean(repo, branch, result.revision);
  const evidence = [];
  for (const argv of checks) {
    const run = spawnSync(argv[0], argv.slice(1), { cwd: repo, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    const after = snapshot(repo);
    evidence.push({ argv, exitCode: run.status, signal: run.signal, error: run.error?.message ?? null, stdout: run.stdout ?? '', stderr: run.stderr ?? '' });
    const changedFields = Object.keys(before).filter(key => !same(before[key], after[key]));
    if (changedFields.length || run.status !== 0 || run.error) {
      const error = new Error(changedFields.length
        ? 'Verification changed source, index or refs; evidence invalid, explicit recovery required'
        : `Check failed: ${JSON.stringify(argv)}`);
      // Report only finite diagnostic fields, never command output or secrets.
      error.verification = { status: 'failed', code: changedFields.length ? 'verification-state-changed' : 'check-failed',
        changedFields, checkIndex: evidence.length - 1, exitCode: run.status };
      throw error;
    }
  }
  return { revision: result.revision, checks: evidence };
}
export function refuseFlow(common) {
  requireThat(!existsSync(join(common, 'codex-flow')), 'Flow state exists; adoption requires a separate preservation-first decision');
}
