import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDelegationMentionMarkdown,
  parseMentionMarkdown,
} from "../src/mentions/mentionMarkdown.js";
import { normalizePromptMentionDisplayLabel } from "../src/mentions/promptMentionLabel.js";

test("API delegation links retain readable labels and are never treated as project files", () => {
  const label = "model/[中文] (API Provider)";
  const markdown = buildDelegationMentionMarkdown(label, "api.70726f7669646572.6d6f64656c");
  assert.deepEqual(parseMentionMarkdown(markdown), [
    { type: "subagent", label, reference: "api.70726f7669646572.6d6f64656c" },
  ]);
  assert.deepEqual(parseMentionMarkdown("@acp.codex"), [{ type: "subagent", label: "acp.codex" }]);
  assert.equal(parseMentionMarkdown("[@not an agent](src/test.ts)")[0]!.type, "file");
});

test("ACP chips share catalog labels before send, after send and when restoring old drafts", () => {
  const part = parseMentionMarkdown("@acp.deepseek")[0]!;
  assert.equal(part.type, "subagent");
  if (part.type !== "subagent") return;
  const composer = normalizePromptMentionDisplayLabel(
    "subagents",
    "DeepSeek Harness",
    "acp.deepseek",
  );
  assert.equal(composer, "DeepSeek Harness");
  assert.equal(normalizePromptMentionDisplayLabel("subagents", part.label, part.label), composer);
  assert.equal(
    normalizePromptMentionDisplayLabel("subagents", "@acp.deepseek", "acp.deepseek"),
    composer,
  );
});

test("API labels never infer ACP identity and missing metadata keeps a readable fallback", () => {
  const reference = "api.70726f7669646572.6d6f64656c";
  const part = parseMentionMarkdown(buildDelegationMentionMarkdown("acp.deepseek", reference))[0]!;
  assert.equal(part.type, "subagent");
  if (part.type !== "subagent") return;
  assert.equal(
    normalizePromptMentionDisplayLabel("subagents", part.label, part.reference ?? part.label),
    "acp.deepseek",
  );
  for (const label of ["acp.future-agent", "deepseek", "api.unknown", "acp."]) {
    assert.equal(normalizePromptMentionDisplayLabel("subagents", label, label), label);
  }
  assert.equal(
    normalizePromptMentionDisplayLabel("subagents", "", "acp.future-agent"),
    "acp.future-agent",
  );
});
