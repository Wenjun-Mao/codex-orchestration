#!/usr/bin/env node
import { processStopEvent } from '../lib/final-hook.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
let event;
try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
catch { process.stdout.write('{}\n'); process.exit(0); }

try {
  const captured = await processStopEvent(event);
  if (captured.notificationOutcome?.status === 'ambiguous') {
    process.stderr.write(`Relay report preserved; notification uncertain: ${captured.notificationOutcome.reason}\n`);
  }
  // Only an assignment frozen under the old mode can request a continuation.
  process.stdout.write(JSON.stringify(captured.hookOutput ?? {}) + '\n');
} catch (error) {
  process.stderr.write(`Relay final capture failed: ${error.message}\n`);
  process.exitCode = 1;
}
