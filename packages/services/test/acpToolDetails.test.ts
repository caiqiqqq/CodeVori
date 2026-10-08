import assert from "node:assert/strict";
import test from "node:test";
import { ACP_TOOL_DETAIL_MAX_CHARS } from "@zcode/shared";
import { projectAcpToolDetails } from "../src/acp/acpToolDetails.js";

test("ACP tool details preserve explicit empty values and omit absent partial fields", () => {
  assert.deepEqual(projectAcpToolDetails({ toolCallId: "tool", status: "completed" }), {});
  assert.deepEqual(
    projectAcpToolDetails({ toolCallId: "tool", rawInput: null, rawOutput: "", content: [] }),
    {
      input: "null",
      inputTruncated: false,
      output: "",
      outputTruncated: false,
      content: "",
      contentTruncated: false,
    },
  );
  const details = projectAcpToolDetails({
    toolCallId: "tool",
    title: "Edit",
    kind: "edit",
    name: "apply_patch",
    rawInput: { file: "sample.ts" },
    rawOutput: "x".repeat(70_000),
    content: [{ type: "diff", path: "sample.ts", oldText: "before", newText: "after" }],
  });
  assert.equal(details.toolName, "apply_patch");
  assert.equal(details.toolKind, "edit");
  assert.equal(details.output?.length, ACP_TOOL_DETAIL_MAX_CHARS);
  assert.equal(details.outputTruncated, true);
  assert.match(details.content ?? "", /before\n→\nafter/);
  const longContent = projectAcpToolDetails({
    toolCallId: "tool",
    content: [{ type: "content", content: { type: "text", text: "x".repeat(70_000) } }],
  });
  assert.equal(longContent.content?.length, ACP_TOOL_DETAIL_MAX_CHARS);
  assert.equal(longContent.contentTruncated, true);
});
