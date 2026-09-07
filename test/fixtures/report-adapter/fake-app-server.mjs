const scenario = process.argv[2] ?? "accepted";

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  while (true) {
    const newline = input.indexOf("\n");
    if (newline < 0) return;
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (line === "") continue;
    receive(JSON.parse(line));
  }
});

function receive(message) {
  if (message.method === "initialize") {
    if (scenario === "eof") return process.exit(0);
    if (scenario === "malformed") {
      process.stdout.write("not-json\n");
      return;
    }
    if (scenario === "partial") {
      process.stdout.write('{"id":1,"result":{}');
      return;
    }
    if (scenario === "overflow") {
      process.stdout.write("x".repeat(40_000));
      return;
    }
    if (scenario === "timeout" || scenario === "stubborn") return;
    if (scenario === "startup-diagnostic") process.stderr.write("migration required\n");
    if (scenario === "coalesced") {
      process.stdout.write('{"id":1,"result":{}}\n{"id":99,"result":{}}\n');
      return;
    }
    send({ id: 1, result: {} });
    return;
  }
  if (message.method === "thread/queue/add") {
    process.stderr.write(`queue:${message.params.input[0].text}\n`);
    if (scenario === "empty-ack") return send({ id: 2, result: { queuedSubmission: { id: "" } } });
    if (scenario === "malformed-ack") return send({ id: 2, result: { queuedSubmission: "bad" } });
    send({ id: 2, result: { queuedSubmission: { id: "queue-ack" } } });
    if (scenario === "delayed-diagnostic") process.stderr.write("recovery after acknowledgement\n");
  }
  if (message.method === "thread/read") {
    const type = scenario === "archive-active" ? "active" : "idle";
    send({ id: 2, result: { thread: { id: message.params.threadId, status: { type, ...(type === "active" ? { activeFlags: [] } : {}) } } } });
    return;
  }
  if (message.method === "thread/archive") {
    if (scenario === "archive-ambiguous") return;
    send({ id: 3, result: {} });
  }
}

if (scenario === "stubborn") {
  process.on("SIGTERM", () => {});
}
