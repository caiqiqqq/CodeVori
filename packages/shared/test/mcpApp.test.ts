import assert from "node:assert/strict";
import test from "node:test";
import { buildMcpAppDocument, readMcpAppResource, readMcpAppResourceUri } from "../src/mcp-app.ts";

test("MCP app descriptor and resource require same ui URI and HTML MIME", () => {
  assert.equal(readMcpAppResourceUri({ ui: { resourceUri: "https://example.com" } }), undefined);
  assert.equal(readMcpAppResourceUri({ "ui/resourceUri": "ui://test" }), "ui://test");
  const item = {
    uri: "ui://test",
    mimeType: "text/html;profile=mcp-app",
    text: "<button>Run</button>",
  };
  assert.ok(readMcpAppResource("ui://test", { contents: [item] }));
  assert.equal(readMcpAppResource("ui://other", { contents: [item] }), null);
  assert.equal(
    readMcpAppResource("ui://test", { contents: [{ ...item, mimeType: "text/javascript" }] }),
    null,
  );
  assert.equal(
    readMcpAppResource("ui://test", { contents: [{ ...item, text: "x".repeat(524289) }] }),
    null,
  );
  assert.equal(
    readMcpAppResource("ui://test", { contents: [{ ...item, text: "字".repeat(180000) }] }),
    null,
  );
});

test("CSP strips wildcards, credentials, paths and directive injection", () => {
  const document = buildMcpAppDocument({
    resourceUri: "ui://test",
    html: "<p>OK</p>",
    connectDomains: [
      "https://api.example",
      "https://example/evil",
      "https://x'; default-src *",
      "https://u:p@host.example",
    ],
    resourceDomains: ["https://cdn.example", "*"],
  });
  assert.ok(document.includes("connect-src https://api.example;"));
  assert.ok(document.includes("frame-src 'none'"));
  assert.ok(!document.includes("default-src *"));
  assert.ok(!document.includes("u:p"));
  assert.ok(document.indexOf("Content-Security-Policy") < document.indexOf("<p>OK</p>"));
});

test("background retention metadata is opt-in and survives the persisted resource", () => {
  const item = { uri: "ui://retention", mimeType: "text/html", text: "<p>retained</p>" };
  const read = (value: unknown) =>
    readMcpAppResource(item.uri, {
      contents: [{ ...item, _meta: { ui: { backgroundRetention: value } } }],
    });
  assert.equal(read(true)?.backgroundRetention, true);
  assert.equal(read(false)?.backgroundRetention, false);
  assert.equal(read("true")?.backgroundRetention, undefined);
});
