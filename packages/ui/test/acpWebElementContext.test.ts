import assert from "node:assert/strict";
import test from "node:test";
import { buildAcpConversationRows } from "@zcode/shared";
import {
  parseComposerPromptContexts,
  serializeComposerPromptContexts,
} from "../src/v4/composer/composerPromptContexts.ts";

test("ACP user rows recover API-format web element context from prompt text", () => {
  const workspace = { workspacePath: "/project", workspaceIdentity: "remote-project" };
  const prompt = serializeComposerPromptContexts("调整这两个按钮", {
    codeComments: [],
    conversationSelections: [],
    webElements: ["save", "cancel"].map((name) => ({
      id: name,
      ...workspace,
      pageUrl: "https://example.test/settings",
      pageTitle: "Settings",
      tagName: "BUTTON",
      accessibleName: name,
      selector: `#${name}`,
      capturedAt: 1,
    })),
    pptxElements: [],
  });
  const userRow = buildAcpConversationRows({
    status: "idle",
    entries: [{ id: "user:one", kind: "user", text: prompt }],
  }).find((row) => row.kind === "userInput");
  assert.equal(userRow?.kind, "userInput");
  const parsed = parseComposerPromptContexts(userRow.text, workspace);
  assert.equal(parsed.visibleContent, "调整这两个按钮");
  assert.deepEqual(
    parsed.webElements.map((element) => [element.accessibleName, element.selector]),
    [
      ["save", "#save"],
      ["cancel", "#cancel"],
    ],
  );
  assert.equal(parsed.webElements[0]?.workspaceIdentity, "remote-project");
});
