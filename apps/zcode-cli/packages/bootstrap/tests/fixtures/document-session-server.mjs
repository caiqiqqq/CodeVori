import { createInterface } from "node:readline";
const documents = new Map();
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === "initialize") result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "document-session-fixture", version: "1" } };
  else if (request.method === "tools/list") result = { tools: ["open", "current"].map((name) => ({ name, inputSchema: { type: "object" } })) };
  else if (request.method === "tools/call") {
    const meta = request.params._meta ?? {};
    const owner = meta.root_session_id ?? meta.session_id;
    if (request.params.name === "open") documents.set(owner, request.params.arguments.path);
    const path = documents.get(owner) ?? null;
    result = { content: [{ type: "text", text: path ?? "no document" }], structuredContent: { pid: process.pid, path, sessionId: meta.session_id, rootSessionId: meta.root_session_id } };
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
});
