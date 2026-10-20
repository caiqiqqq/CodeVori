import assert from "node:assert/strict";
import test from "node:test";
import { resolveVisibleModelProviderNodeKey } from "../src/settings/model-provider-section/modelProviderSidebarSelection.ts";

test("a hidden built-in selection returns to the first visible custom provider", () => {
  const customKeys = ["custom:bigmodel-api", "custom:new-provider"];
  assert.equal(
    resolveVisibleModelProviderNodeKey("preset:bigmodel-start-plan", customKeys),
    customKeys[0],
  );
  assert.equal(
    resolveVisibleModelProviderNodeKey("coding-plan:bigmodel", customKeys),
    customKeys[0],
  );
  assert.equal(resolveVisibleModelProviderNodeKey(null, customKeys), customKeys[0]);
});

test("refresh keeps a visible custom selection and recovers when it is removed", () => {
  const customKeys = ["custom:first", "custom:second"];
  assert.equal(resolveVisibleModelProviderNodeKey(customKeys[1], customKeys), customKeys[1]);
  assert.equal(resolveVisibleModelProviderNodeKey(customKeys[1], [customKeys[0]]), customKeys[0]);
  assert.equal(resolveVisibleModelProviderNodeKey(customKeys[1], []), null);
});
