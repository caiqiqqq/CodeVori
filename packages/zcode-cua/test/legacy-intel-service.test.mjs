import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyIntelService } from "../legacy-intel-service.mjs";

test("Intel adapter preserves click counts and holds through the same public method interface", async () => {
  const calls = [];
  const { service } = createLegacyIntelService({
    createLegacy: () => ({
      callTool: async (name, args) => {
        calls.push([name, args]);
        return {};
      },
    }),
  });
  await service.callTool("left_click", {
    mouse_button: "left",
    click_count: 2,
    target: { type: "element", index: 0 },
  });
  await service.callTool("left_click", { mouse_button: "right", click_count: 1 });
  await service.callTool("key", { text: "a", hold_seconds: 0.5 });
  assert.deepEqual(calls, [
    ["double_click", { target: { type: "element", index: 0 } }],
    ["right_click", {}],
    ["hold_key", { text: "a", duration: 0.5 }],
  ]);
  assert.equal(
    (await service.callTool("paste", { text: "preserve clipboard" })).structuredContent.action_sent,
    false,
  );
  assert.equal(calls.length, 3);
});
