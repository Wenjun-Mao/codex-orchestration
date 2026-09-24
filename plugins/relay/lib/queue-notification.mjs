import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Compatibility is determined by the protocol responses, not an App release pin.
const binary = '/Applications/ChatGPT.app/Contents/Resources/codex';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function submitQueueNotification(request, {
  spawnProcess = spawn, deadlineMs = 6000, cleanupMs = 500, titleLookupMs = 500,
  outputLimit = Math.max(65536, Buffer.byteLength(typeof request.text === 'string' ? request.text : '') * 6 + 65536),
} = {}) {
  const uncertain = reason => ({ status: 'ambiguous', reason });
  if (!uuid.test(request.id) || !uuid.test(request.recipient) || !uuid.test(request.sender)
    || typeof request.text !== 'string') return uncertain('invalid-queue-request');
  // Missing host echoes are allowed by the existing same-host assignment
  // contract; an explicit remote identity is never routed through local IPC.
  if ([request.hostId, request.senderHostId].some(host => host != null && host !== 'local')) return uncertain('unsupported-host');
  return new Promise(resolve => {
    let child, buffer = '', bytes = 0, sent = false, queuedRequest = false, finishing = false;
    let messageText;
    let outcome = uncertain('transport-closed'), deadline, titleTimer, killTimer, settleTimer;
    const expiresAt = performance.now() + deadlineMs;
    const decoder = new StringDecoder('utf8');
    const finish = result => {
      if (finishing) return;
      finishing = true; outcome = result;
      clearTimeout(deadline); clearTimeout(titleTimer);
      child.stdin.end();
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        // Inherited pipes must not keep the hook alive after the direct child.
        settleTimer = setTimeout(() => {
          outcome = { ...outcome, cleanupWarning: 'transport-cleanup-unconfirmed' };
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
          child.unref?.();
          resolve(outcome);
        }, cleanupMs);
      }, cleanupMs);
    };
    try { child = spawnProcess(binary, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { resolve(uncertain('transport-unavailable')); return; }
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    const queue = (name = '') => {
      if (finishing || queuedRequest) return;
      clearTimeout(titleTimer);
      messageText = `From: ${name || request.sender}\n\n${request.text}`;
      queuedRequest = true;
      send({ id: 2, method: 'thread/queue/add', params: {
        threadId: request.recipient, clientUserMessageId: request.id,
        input: [{ type: 'text', text: messageText }],
      } });
    };
    child.on('error', () => finish(uncertain('transport-unavailable')));
    child.stdin.on('error', () => finish(uncertain('transport-write-error')));
    child.on('close', () => {
      finishing = true;
      clearTimeout(deadline); clearTimeout(titleTimer); clearTimeout(killTimer); clearTimeout(settleTimer);
      resolve(outcome);
    });
    child.stderr.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > outputLimit) finish(uncertain('transport-output-limit'));
    });
    child.stdout.on('data', chunk => {
      if (finishing) return;
      bytes += chunk.length;
      if (bytes > outputLimit) return finish(uncertain('transport-output-limit'));
      buffer += decoder.write(chunk);
      while (!finishing && buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value;
        try { value = JSON.parse(line); }
        catch { finish(uncertain('transport-invalid-json')); return; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) return finish(uncertain('transport-invalid-message'));
        if (value.id === 1) {
          if (sent) return finish(uncertain('duplicate-initialize-response'));
          if (value.error || value.result?.codexHome !== join(homedir(), '.codex')
            || typeof value.result?.userAgent !== 'string'
            || !value.result.userAgent.startsWith('Codex Desktop/')) {
            return finish(uncertain('unexpected-host-or-home'));
          }
          send({ method: 'initialized' });
          sent = true;
          // Metadata is optional; reserve most of the remaining deadline for the send.
          const allowance = Math.min(titleLookupMs, Math.max(0, expiresAt - performance.now()) / 4);
          titleTimer = setTimeout(() => queue(), allowance);
          send({ id: 3, method: 'thread/read', params: { threadId: request.sender, includeTurns: false } });
        } else if (value.id === 3 && sent && !queuedRequest) {
          const thread = value.result?.thread;
          const name = !value.error && thread?.id === request.sender && typeof thread.name === 'string'
            ? thread.name.replace(/[\r\n\u2028\u2029]+/g, ' ').trim() : '';
          queue(name);
        } else if (value.id === 2 && queuedRequest) {
          const queued = value.result?.queuedSubmission;
          const exact = !value.error && uuid.test(queued?.id)
            && queued.clientUserMessageId === request.id && queued.input?.length === 1
            && Array.isArray(queued.input) && queued.input[0]?.type === 'text' && queued.input[0].text === messageText;
          finish(exact ? { status: 'queued', reason: 'exact-queue-response' } : uncertain('queue-response-unconfirmed'));
        }
      }
    });
    deadline = setTimeout(() => finish(uncertain('transport-timeout')), deadlineMs);
    send({ id: 1, method: 'initialize', params: {
      clientInfo: { name: 'relay_hook_notification', version: '1' },
      capabilities: { experimentalApi: true },
    } });
  });
}
