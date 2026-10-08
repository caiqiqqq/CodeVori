import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDelegationMentionMarkdown,
  parseMentionMarkdown,
} from "../src/mentions/mentionMarkdown.js";

test("API delegation links retain readable labels and are never treated as project files", () => {
  const label = "model/[中文] (API Provider)";
  const markdown = buildDelegationMentionMarkdown(label, "api.70726f7669646572.6d6f64656c");
  assert.deepEqual(parseMentionMarkdown(markdown), [{ type: "subagent", label }]);
  assert.deepEqual(parseMentionMarkdown("@acp.codex"), [{ type: "subagent", label: "acp.codex" }]);
  assert.equal(parseMentionMarkdown("[@not an agent](src/test.ts)")[0]!.type, "file");
});
