import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeTaskFindSelection,
  createTaskFindNavigationState,
  navigateTaskFindSelection,
} from "../src/quickpick/taskFindNavigationState.js";

test("repeated empty timeline results preserve the App state identity", () => {
  const state = createTaskFindNavigationState();
  for (let index = 0; index < 100; index++) {
    assert.equal(changeTaskFindSelection(state, "", -1), state);
  }
});

test("query or active match changes retain the navigation request identity", () => {
  const state = navigateTaskFindSelection(createTaskFindNavigationState(), "match", 0);
  const nextMatch = changeTaskFindSelection(state, "match", 1);
  assert.notEqual(nextMatch, state);
  assert.deepEqual(nextMatch, { ...state, activeIndex: 1 });
  assert.equal(changeTaskFindSelection(nextMatch, "match", 1), nextMatch);
  const nextQuery = changeTaskFindSelection(nextMatch, "other", 1);
  assert.deepEqual(nextQuery, { ...nextMatch, query: "other" });
  assert.equal(changeTaskFindSelection(nextQuery, "other", 1), nextQuery);
});

test("clearing matches settles once without canceling explicit navigation", () => {
  const state = navigateTaskFindSelection(createTaskFindNavigationState(), "match", 0);
  const cleared = changeTaskFindSelection(state, "", -1);
  assert.deepEqual(cleared, { activeIndex: -1, navigationRequestId: 1, query: "" });
  assert.equal(changeTaskFindSelection(cleared, "", -1), cleared);
});

test("explicit navigation to the same single match remains a new command", () => {
  const state = navigateTaskFindSelection(createTaskFindNavigationState(), "match", 0);
  const next = navigateTaskFindSelection(state, "match", 0);
  assert.notEqual(next, state);
  assert.deepEqual(next, { ...state, navigationRequestId: state.navigationRequestId + 1 });
  assert.equal(changeTaskFindSelection(next, "match", 0), next);
});
