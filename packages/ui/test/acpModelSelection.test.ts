import assert from "node:assert/strict";
import test from "node:test";
import {
  acpAgentFromModelValue,
  buildAcpModelSelectGroup,
  selectAcpSession,
} from "../src/v4/composer/acpModelSelection.ts";
import { ACP_AGENT_CATALOG, type AcpSession } from "@zcode/shared";
import {
  getAcpComposerBlockingReason,
  hasAcpConversationContent,
} from "../src/v4/composer/acpComposerRouting.ts";

test("ACP targets have distinct model-menu values and do not consume API model values", () => {
  const group = buildAcpModelSelectGroup(
    "Agents",
    ACP_AGENT_CATALOG.map(({ id }) => ({ agent: id, enabled: true, ready: true })),
  );
  assert.equal(group.directItems, true);
  assert.deepEqual(
    group.items.map((item) => item.name),
    [
      "Claude ACP",
      "Codex ACP",
      "Gemini CLI",
      "OpenClaw",
      "OpenCode",
      "Cline",
      "Hermes Agent",
      "CodeBuddy",
      "Kimi Code",
      "Pi",
      "Grok",
      "Cursor",
      "DeepSeek Harness",
      "Qoder",
      "Google Antigravity",
    ],
  );
  assert.deepEqual(
    group.items.map((item) => acpAgentFromModelValue(item.value)),
    [
      "claude",
      "codex",
      "gemini",
      "openclaw",
      "opencode",
      "cline",
      "hermes",
      "codebuddy",
      "kimi-code",
      "pi",
      "grok",
      "cursor",
      "deepseek",
      "qoder",
      "antigravity",
    ],
  );
  assert.equal(acpAgentFromModelValue("openai/gpt-6"), null);
  assert.equal(acpAgentFromModelValue("acp:unknown"), null);
});

test("model menu includes only enabled and runnable adapters from the target Host", () => {
  const agents = [
    { agent: "gemini" as const, enabled: true, ready: true },
    { agent: "pi" as const, enabled: true, ready: false },
    { agent: "codex" as const, enabled: true, ready: true },
    { agent: "claude" as const, enabled: false, ready: true },
    { agent: "openclaw" as const, enabled: false, ready: false },
  ];
  assert.deepEqual(
    buildAcpModelSelectGroup("Agents", agents).items.map(({ value }) => value),
    ["acp:codex", "acp:gemini"],
  );
  assert.deepEqual(buildAcpModelSelectGroup("Agents", []).items, []);
});

test("a new draft never falls back to Agent history; an explicit id stays exact", () => {
  const sessions = [
    { id: "claude", agent: "claude" },
    { id: "codex-new", agent: "codex" },
    { id: "codex-old", agent: "codex" },
  ] as AcpSession[];
  assert.equal(selectAcpSession(sessions, "codex", null), null);
  assert.equal(selectAcpSession(sessions, "codex", "claude"), null);
  assert.equal(selectAcpSession(sessions, "codex", "codex-old")?.id, "codex-old");
  assert.equal(selectAcpSession(sessions, "claude", "codex-old"), null);
  assert.equal(selectAcpSession([], "claude", null), null);
});

test("one composer routes ACP content while native-only context remains blocked", () => {
  const clean = {
    codeComments: false,
    webElements: false,
    pptxElements: false,
    selections: false,
    sharedContext: false,
  };
  assert.equal(getAcpComposerBlockingReason(clean), null);
  assert.equal(getAcpComposerBlockingReason({ ...clean, sharedContext: true }), "context");
  assert.equal(getAcpComposerBlockingReason({ ...clean, selections: true }), "context");
});

test("an empty ACP session keeps the centered draft layout", () => {
  assert.equal(
    hasAcpConversationContent({ entries: [], pendingPermission: null, error: null }),
    false,
  );
  assert.equal(
    hasAcpConversationContent({ entries: [], pendingPermission: null, error: "disconnected" }),
    false,
  );
  assert.equal(
    hasAcpConversationContent({
      entries: [{ id: "user", kind: "user", text: "hello" }],
      pendingPermission: null,
      error: null,
    }),
    true,
  );
});
