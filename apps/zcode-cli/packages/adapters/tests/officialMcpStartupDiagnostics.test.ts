import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMcpFailureStatusMessage,
  sanitizeMcpStdioStderr,
} from "../src/mcp/startup-diagnostics.js";

test("stdio startup failure shows bounded diagnostics without secrets or ANSI escapes", () => {
  const stderr = [
    "noise".repeat(1_000),
    "\u001b[31mModuleNotFoundError: No module named 'mcp'\u001b[0m",
    'API_TOKEN="first secret with spaces"',
    String.raw`VE_SPEECH_MCP_TOKEN="second escaped\" secret"`,
  ].join("\n");
  const message = buildMcpFailureStatusMessage("Connection closed", stderr, "stdio");
  assert.match(message, /ModuleNotFoundError/);
  assert.match(message, /Connection closed/);
  assert.ok(!message.includes("\u001b"));
  assert.doesNotMatch(message, /first secret|second escaped|spaces/);
  assert.ok(message.length <= 4_520);
});

test("HTTP failures do not include process stderr", () => {
  assert.equal(
    buildMcpFailureStatusMessage("network unavailable", "secret", "http"),
    "network unavailable",
  );
});

test("credential sanitizer handles quoted JSON, URLs and prefixed names", () => {
  const result = sanitizeMcpStdioStderr(
    String.raw`{"access_token":"third escaped\" secret"} API_TOKEN=plain https://name:password@example.test`,
  );
  assert.doesNotMatch(result, /third|secret|plain|name:password/);
  assert.match(result, /\[Redacted\]/);
});
