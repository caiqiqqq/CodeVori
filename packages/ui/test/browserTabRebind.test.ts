import assert from "node:assert/strict";
import test from "node:test";
import { safeWebviewCall } from "../src/embeddedBrowserHelpers.js";
import {
  applyBrowserUseSidePaneEvent,
  openBrowserSidePane,
  type WorkspaceSidePaneState,
} from "../src/lib/workspaceSidePane.js";

const owner = {
  workspaceKey: "/fixture/project-a",
  sessionId: "session-a",
  tabId: "browser:original",
  browserId: "unclaimed-iab",
  browserGeneration: 0,
};
const activeScope = { workspaceKey: owner.workspaceKey, ownerTaskId: owner.sessionId };
const createHumanTab = () =>
  openBrowserSidePane(null, {
    ...owner,
    ownerTaskId: owner.sessionId,
    initialUrl: "file:///fixture/preview.html",
  });

test("human Ready replay preserves the original shell and never reveals the collapsed pane", () => {
  const original = createHumanTab();
  for (const browserId of ["unclaimed-iab", "iab:claimed"]) {
    const first = applyBrowserUseSidePaneEvent(original, { ...owner, browserId }, activeScope);
    const replay = applyBrowserUseSidePaneEvent(first.state, { ...owner, browserId }, activeScope);
    assert.deepEqual(first.state, original);
    assert.deepEqual(replay.state, original);
    assert.equal(first.shouldReveal, false);
    assert.equal(replay.shouldReveal, false);
  }
});

test("rebind of an inactive human tab preserves the selected tab", () => {
  const original = openBrowserSidePane(createHumanTab(), {
    ...owner,
    tabId: "browser:second",
    ownerTaskId: owner.sessionId,
    initialUrl: "https://example.test/second",
  });
  const result = applyBrowserUseSidePaneEvent(original, owner, activeScope);
  assert.deepEqual(result.state, original);
  assert.equal(result.shouldReveal, false);
});

test("first controlled Ready opens the current pane, while replay only refreshes metadata", () => {
  const controlled = { ...owner, tabId: "controlled", browserId: "iab:agent" };
  const first = applyBrowserUseSidePaneEvent(null, controlled, activeScope);
  assert.equal(first.shouldReveal, true);
  assert.equal(first.state?.tabs.length, 1);
  const another = openBrowserSidePane(first.state, { tabId: "browser:other" });
  const replay = applyBrowserUseSidePaneEvent(
    another,
    { ...controlled, browserGeneration: 1 },
    activeScope,
  );
  assert.equal(replay.shouldReveal, false);
  assert.equal(replay.state?.activeTabId, another.activeTabId);
  assert.equal(replay.state?.tabs.length, 2);
  assert.equal(replay.state?.tabs[0]?.type, "browser-use");
  assert.equal(
    replay.state?.tabs[0]?.type === "browser-use" && replay.state.tabs[0].browserGeneration,
    1,
  );
});

test("background controlled Ready cannot select a tab or reveal another owner", () => {
  const original = createHumanTab();
  const result = applyBrowserUseSidePaneEvent(
    original,
    { ...owner, tabId: "controlled", browserId: "iab:agent", sessionId: "session-b" },
    activeScope,
  );
  assert.equal(result.shouldReveal, false);
  assert.equal(result.state?.activeTabId, original.activeTabId);
});

test("scope conflicts cannot create a second shell for the same logical tab", () => {
  for (const scope of [
    { workspaceKey: "/fixture/project-b" },
    { sessionId: "session-b" },
    { remoteSessionId: "remote-b" },
  ]) {
    const original = createHumanTab();
    const result = applyBrowserUseSidePaneEvent(original, { ...owner, ...scope }, activeScope);
    assert.deepEqual(result.state, original);
    assert.equal(result.shouldReveal, false);
  }
});

test("late Ready cannot resurrect a missing unclaimed human shell", () => {
  for (const original of [null, { tabs: [], activeTabId: "" } as WorkspaceSidePaneState]) {
    const result = applyBrowserUseSidePaneEvent(original, owner, activeScope);
    assert.equal(result.state, original);
    assert.equal(result.shouldReveal, false);
  }
});

test("late guest events after Main closes it use the detached fallback", () => {
  const error = new Error("Invalid guestInstanceId: 5");
  const detached: unknown[] = [];
  assert.equal(
    safeWebviewCall(
      () => {
        throw error;
      },
      "about:blank",
      (value) => detached.push(value),
    ),
    "about:blank",
  );
  assert.deepEqual(detached, [error]);
});

test("guest lifecycle handling still propagates unrelated errors", () => {
  const error = new Error("Unexpected state synchronization error");
  assert.throws(
    () =>
      safeWebviewCall(() => {
        throw error;
      }, "about:blank"),
    error,
  );
});
