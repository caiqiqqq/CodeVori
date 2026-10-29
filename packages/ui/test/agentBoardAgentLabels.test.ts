import test from "node:test";
import assert from "node:assert/strict";
import { boardAgentLabel, type BoardItem } from "../src/agent-board/agentBoardModel.js";

test("board labels normalize ACP sessions and work tasks without changing filter keys", () => {
  for (const [agent, label] of [
    ["codex", "Codex"],
    ["claude", "Claude"],
    ["gemini", "Gemini CLI"],
    ["unknown", "unknown"],
  ]) {
    const session = { kind: "acp", agent, session: { agent } } as BoardItem;
    const task = {
      kind: "work-task",
      agent,
      workTask: { execution: { kind: "acp", agent } },
    } as BoardItem;
    for (const item of [session, task]) {
      assert.equal(boardAgentLabel(item), label);
      assert.equal(item.agent, agent);
    }
  }
});

test("API provider and model display names remain intact", () => {
  assert.equal(boardAgentLabel({ kind: "native", agent: "API" } as BoardItem), "API");
  assert.equal(
    boardAgentLabel({
      kind: "work-task",
      agent: "custom-model",
      workTask: { execution: { kind: "api" } },
    } as BoardItem),
    "custom-model",
  );
});
