import { mkdtempSync, readFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const started = performance.now();
const source = fileURLToPath(new URL('../', import.meta.url));
const target = mkdtempSync(join(tmpdir(), 'relay-packed-boundary-'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const [pack] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', target], source));
const manifest = JSON.parse(readFileSync(join(source, 'runtime-files.json'), 'utf8'));
const files = pack.files.map(file => file.path).sort();
assert.deepEqual(files, [...manifest].sort(), 'Package must match the explicit Relay-only file manifest');
run('tar', ['-xzf', join(target, pack.filename), '-C', target], target);
const unpacked = join(target, 'package');
for (const file of files.filter(path => path.endsWith('.mjs'))) {
  const text = readFileSync(join(unpacked, file), 'utf8');
  assert.doesNotMatch(text, /\b(?:import\s*\(|require\s*\(|eval\s*\()/, 'No unreviewed dynamic runtime loading');
  for (const [, specifier] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (specifier.startsWith('node:')) continue;
    assert.ok(specifier.startsWith('.'), `External dependency: ${specifier}`);
    const path = resolve(dirname(join(unpacked, file)), specifier);
    assert.ok(path.startsWith(unpacked + '/') && existsSync(path), `Dependency escapes packed Relay: ${specifier}`);
  }
}
assert.equal(existsSync(join(target, 'lib')), false, 'Flow must not be staged alongside Relay');
const help = run(process.execPath, [join(unpacked, 'bin/relay.mjs'), '--help'], target);
const version = JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8')).version;
assert.ok(help.includes(`Relay ${version} — same-host serial source coordination`));
assert.match(help, /start --repo PATH --ticket GENERATED --actor-env CODEX_THREAD_ID/);
assert.doesNotMatch(help, /See README/);
const deliverySkill = readFileSync(join(unpacked, 'skills/deliver/SKILL.md'), 'utf8');
assert.match(deliverySkill, /host-provided `CODEX_THREAD_ID`/);
assert.doesNotMatch(deliverySkill, /\]\(\.\.\/\.\.\/README\.md\)/);
// Copy connected and reporting harnesses; their imports resolve to the relocated package.
mkdirSync(join(unpacked, 'test'));
for (const file of ['helpers.mjs', 'journey.test.mjs', 'native.test.mjs', 'reports.test.mjs', 'notification.test.mjs']) cpSync(join(source, 'test', file), join(unpacked, 'test', file), { recursive: false });
const output = run(process.execPath, ['--test', join(unpacked, 'test/journey.test.mjs'), join(unpacked, 'test/native.test.mjs'), join(unpacked, 'test/reports.test.mjs'), join(unpacked, 'test/notification.test.mjs')], target);
process.stdout.write(output);
process.stdout.write(JSON.stringify({ package: join(target, pack.filename), fileCount: files.length, packedBytes: pack.size, unpackedBytes: pack.unpackedSize, elapsedMs: Math.round(performance.now() - started), nativeQualification: 'not exercised; fixture observations only' }, null, 2) + '\n');
