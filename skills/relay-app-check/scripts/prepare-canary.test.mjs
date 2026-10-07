import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareCanary } from './prepare-canary.mjs';

const manager = '01a1187e-4c98-7490-b9ef-5e2cb715e897';
const worker = '22222222-2222-4222-8222-222222222222';
const env = { CODEX_THREAD_ID: manager };
const script = fileURLToPath(new URL('./prepare-canary.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'relay-canary-preparation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "source checkout's 雪");
  const pluginRoot = join(root, "installed Relay's 雪");
  mkdirSync(repo);
  mkdirSync(join(pluginRoot, '.codex-plugin'), { recursive: true });
  mkdirSync(join(pluginRoot, 'bin'));
  writeFileSync(join(pluginRoot, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'relay', version: '0.4.2+fixture' }));
  writeFileSync(join(pluginRoot, 'bin/relay.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));');
  return { root, options: { repo, pluginRoot, projectId: 'local-project:fixture', env } };
}

function snapshot(root) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => [join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name), 'utf8')]));
}

function cli(options, extra = [], entrypoint = script) {
  return spawnSync(process.execPath, [entrypoint, '--repo', options.repo,
    '--plugin-root', options.pluginRoot, '--project-id', options.projectId, ...extra], {
    env: { ...process.env, ...options.env }, encoding: 'utf8',
  });
}

test('native arguments use local target and one host identity in brief and executable command', t => {
  const { options } = fixture(t);
  const args = prepareCanary(options);
  assert.deepEqual(Object.keys(args).sort(), ['prompt', 'target', 'title']);
  assert.deepEqual(args.target, { type: 'project', projectId: options.projectId, environment: { type: 'local' } });
  assert.ok(args.prompt.includes(`Manager/checker native thread ID: ${manager}\n`));
  const command = args.prompt.split('\n').find(line => line.startsWith('node '));
  const result = spawnSync('/bin/sh', ['-c', command], {
    env: { ...process.env, CODEX_THREAD_ID: worker }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    'register', '--repo', realpathSync(options.repo), '--worker', worker, '--manager', manager,
  ]);
});

test('each preparation has a unique token shared by title and exact Unicode final', t => {
  const { options } = fixture(t);
  const first = prepareCanary(options), second = prepareCanary(options);
  assert.notEqual(first.title, second.title);
  for (const args of [first, second]) {
    const token = args.title.slice('Relay native Stop-hook check '.length);
    assert.match(token, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    assert.equal(args.prompt.split('\n').at(-1), `Relay native Stop-hook check — ${token}, exact text, 雪.`);
  }
});

test('selectors are omitted by default and preserved only when explicitly supplied', t => {
  const { options } = fixture(t);
  const args = prepareCanary({ ...options, model: 'gpt-6-luna', thinking: 'max' });
  assert.deepEqual(Object.keys(args).sort(), ['model', 'prompt', 'target', 'thinking', 'title']);
  assert.equal(args.model, 'gpt-6-luna');
  assert.equal(args.thinking, 'max');
  assert.throws(() => prepareCanary({ ...options, model: '' }), /model/);
  assert.throws(() => prepareCanary({ ...options, thinking: 'imaginary' }), /reasoning effort/);
});

test('invalid identity or required inputs fail during preparation', t => {
  const { options } = fixture(t);
  for (const badEnv of [{}, { CODEX_THREAD_ID: 'client-new-thread:fixture' }]) {
    assert.throws(() => prepareCanary({ ...options, env: badEnv }), /CODEX_THREAD_ID/);
  }
  assert.throws(() => prepareCanary({ ...options, repo: 'relative' }), /absolute path/);
  assert.throws(() => prepareCanary({ ...options, projectId: '' }), /list_projects/);
  assert.throws(() => prepareCanary({ ...options, pluginRoot: options.repo }), /ENOENT/);
  writeFileSync(join(options.pluginRoot, '.codex-plugin/plugin.json'), '{"name":"other","version":"1.0.0"}');
  assert.throws(() => prepareCanary(options), /identify Relay/);
});

test('CLI prints only launch arguments without executing Relay or writing records', t => {
  const { root, options } = fixture(t);
  writeFileSync(join(options.pluginRoot, 'bin/relay.mjs'), 'throw new Error("Relay must not execute during preparation");');
  const before = snapshot(root);
  const result = cli(options, ['--model', 'gpt-6-luna', '--thinking', 'max']);
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(args).sort(), ['model', 'prompt', 'target', 'thinking', 'title']);
  assert.equal(args.target.projectId, options.projectId);
  assert.ok(args.prompt.includes(`--manager '${manager}'`));
  assert.equal(args.model, 'gpt-6-luna');
  assert.equal(args.thinking, 'max');
  assert.deepEqual(snapshot(root), before);
});

test('CLI works through a discovery symlink and rejects manager overrides with no request', t => {
  const { root, options } = fixture(t);
  const linked = join(root, 'discovered-prepare.mjs');
  symlinkSync(script, linked);
  const prepared = cli(options, [], linked);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(Object.keys(JSON.parse(prepared.stdout)).sort(), ['prompt', 'target', 'title']);
  const rejected = cli(options, ['--manager', worker]);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.equal(JSON.parse(rejected.stderr).status, 'not-prepared');
});
