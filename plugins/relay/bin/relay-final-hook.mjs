#!/usr/bin/env node
import { captureStopEvent } from '../lib/final-hook.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
let event;
try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
catch { process.stdout.write('{}\n'); process.exit(0); }

try {
  const captured = captureStopEvent(event, { notify: true });
  // Only the first committed capture may ask for one advisory-only continuation.
  process.stdout.write(JSON.stringify(captured.hookOutput ?? {}) + '\n');
} catch (error) {
  process.stderr.write(`Relay final capture failed: ${error.message}\n`);
  process.exitCode = 1;
}
