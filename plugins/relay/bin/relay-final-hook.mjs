#!/usr/bin/env node
import { captureStopEvent } from '../lib/final-hook.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
let event;
try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
catch { process.stdout.write('{}\n'); process.exit(0); }

try {
  captureStopEvent(event);
  // Stop hooks accept JSON output. Relay never steers or continues the task.
  process.stdout.write('{}\n');
} catch (error) {
  process.stderr.write(`Relay final capture failed: ${error.message}\n`);
  process.exitCode = 1;
}
