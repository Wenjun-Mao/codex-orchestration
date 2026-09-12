import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Relay } from '../lib/relay.mjs';
export function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'relay-source-test-'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Relay test'); git('config', 'user.email', 'relay@example.test');
  function commit(path, text) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); git('add', '--', path); git('commit', '-m', path); return git('rev-parse', 'HEAD'); }
  commit('src/value.txt', 'baseline');
  const relay = new Relay(repo);
  const spec = { outcome: 'Update value', plan: 'approved-plan.md', acceptance: 'Value is useful', branch: 'main', projectId: 'fixture-project', recipient: 'director', selector: { model: 'fixture-model', thinking: 'low' }, scope: ['src/'], checks: [[process.execPath, '-e', 'process.exit(0)']] };
  function bind(prepared, task, creator = 'director') { return relay.recordNative(prepared.assignment, creator, { actionId: prepared.nativeAction.id, status: 'ready', taskId: task }); }
  function start(task = 'coordinator') { const prepared = relay.prepare(spec, 'director'); bind(prepared, task); return { prepared, ready: relay.start(prepared.ticket, task) }; }
  return { repo, relay, spec, git, commit, bind, start };
}
export function deliver(relay, id, sender, recipient, decision = 'accepted') {
  const report = relay.status(id).report;
  const captured = relay.report('capture', id, sender, { sender, correlation: report.correlation, eventId: 'event-' + id, text: `Actual fixture final for ${id}` });
  const read = relay.readReport(id, recipient);
  relay.report('acknowledge', id, recipient, read.acknowledgement);
  relay.report(decision === 'accepted' ? 'accept' : 'reject', id, recipient);
  const archive = relay.report('retire', id, recipient);
  relay.recordNative(id, recipient, { kind: 'archive', actionId: archive.nativeAction.id, taskId: sender, status: 'archived' });
  return { captured, read, archive };
}
export const cliPath = fileURLToPath(new URL('../bin/relay.mjs', import.meta.url));
export function cli(repo, operation, args = {}, path = cliPath) {
  const argv = [path, operation, '--repo', repo, ...Object.entries(args).flatMap(([k, v]) => [`--${k}`, String(v)])];
  const run = spawnSync(process.execPath, argv, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout);
}
export function jsonFile(value) {
  const root = mkdtempSync(join(tmpdir(), 'relay-observation-'));
  const path = join(root, 'input.json'); writeFileSync(path, JSON.stringify(value)); return path;
}
