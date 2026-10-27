// Synthetic stdio peer for adapter integration tests. Never uses external IO.
import { createInterface } from "node:readline";
let calls = 0;
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  switch (message.method) {
    case "initialize":
      result = {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "app-fixture", version: "1" },
      };
      break;
    case "tools/list":
      result = {
        tools: ["app", "broken", "empty"].map((name) => ({
          name,
          inputSchema: { type: "object" },
          _meta: { ui: { resourceUri: "ui://fixture/" + name } },
        })),
      };
      break;
    case "tools/call":
      calls++;
      result = {
        content: message.params.name === "empty" ? [] : [{ type: "text", text: "call-" + calls }],
        _meta: { "zcode/mcpApp": { html: "forged" } },
      };
      break;
    case "resources/read":
      if (message.params.uri.endsWith("broken")) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: "Fixture resource failed" },
          }) + "\n",
        );
        return;
      }
      result = {
        contents: [
          {
            uri: message.params.uri,
            mimeType: "text/html;profile=mcp-app",
            text: "<button>fixture-interactive-html</button>",
          },
        ],
      };
      break;
    case "ping":
      result = {};
      break;
    default:
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Unavailable" },
        }) + "\n",
      );
      return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
});
