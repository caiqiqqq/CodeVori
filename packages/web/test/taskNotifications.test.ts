import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebTaskNotifications } from "../src/taskNotifications.js";

test("browser notifications preserve focus/permission policy and route original issue clicks", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let focused = true;
  let onlyWhenUnfocused = true;
  let sounds = 0;
  let focuses = 0;
  const shown: FakeNotification[] = [];
  class FakeNotification {
    static permission = "granted";
    onclick?: () => void;
    constructor(
      public title: string,
      public options: { body: string; silent: boolean },
    ) {
      shown.push(this);
    }
  }
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hasFocus: () => focused },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { Notification: FakeNotification, focus: () => focuses++ },
  });
  const adapter = createWebTaskNotifications({
    onlyWhenUnfocused: () => onlyWhenUnfocused,
    playSound: () => {
      sounds++;
    },
  });
  const payload = {
    taskId: "repository-issue-42",
    status: "repository_issue" as const,
    title: "New repository issue",
    body: "repo #42: Synthetic issue",
  };
  const clicks: string[] = [];
  const dispose = adapter.onTaskNotificationClick((id) => clicks.push(id));
  try {
    adapter.showTaskNotification(payload);
    assert.equal(shown.length, 0);
    onlyWhenUnfocused = false;
    adapter.showTaskNotification(payload);
    assert.equal(shown.length, 1);
    assert.equal(sounds, 1);
    assert.equal(shown[0]!.title, payload.title);
    assert.deepEqual(shown[0]!.options, { body: payload.body, silent: true });
    shown[0]!.onclick!();
    assert.deepEqual(clicks, [payload.taskId]);
    assert.equal(focuses, 1);
    dispose();
    shown[0]!.onclick!();
    assert.equal(clicks.length, 1);
    focused = false;
    onlyWhenUnfocused = true;
    FakeNotification.permission = "denied";
    adapter.showTaskNotification(payload);
    assert.equal(shown.length, 1);
    FakeNotification.permission = "granted";
    adapter.showTaskNotification(payload);
    assert.equal(shown.length, 2);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
