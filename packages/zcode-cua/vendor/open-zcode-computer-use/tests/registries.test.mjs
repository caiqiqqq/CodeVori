import assert from "node:assert/strict";
import test from "node:test";
import { FrameRegistry, RegistryError, StateRegistry } from "../src/registries.mjs";

test("state ids are scoped, superseded, expired, and bounded", () => {
  let now = 100;
  const states = new StateRegistry({ maxEntries: 2, ttlMs: 50, now: () => now });
  const first = states.issueState({ target: { pid: 1, windowId: 10 } });
  const second = states.issueState({ target: { pid: 2, windowId: 20 } });
  assert.equal(states.get(second.state_id).target.pid, 2);

  const replacement = states.issueState({ target: { pid: 1, windowId: 10 } });
  assert.throws(
    () => states.get(first.state_id),
    (error) => error instanceof RegistryError && error.code === "superseded",
  );
  assert.equal(states.get(replacement.state_id).target.windowId, 10);

  now = 200;
  assert.throws(
    () => states.get(second.state_id),
    (error) => error instanceof RegistryError && error.code === "expired",
  );
});

test("frame registry resolves the latest actionable raster", () => {
  const frames = new FrameRegistry();
  frames.issueFrame({ actionable: false });
  const live = frames.issueFrame({ actionable: true, width: 10, height: 20 });
  assert.equal(frames.latest().frame_id, live.frame_id);
  frames.consume(live.frame_id);
  assert.throws(() => frames.latest(), /No actionable image frame/u);
});
