import assert from "node:assert/strict";
import test from "node:test";
import {
  isTaskNotificationOnlyWhenUnfocused,
  persistTaskNotificationOnlyWhenUnfocused,
} from "../src/lib/taskNotificationPreferences.ts";

test("focus preference defaults to the existing behavior and persists both choices", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    assert.equal(isTaskNotificationOnlyWhenUnfocused(), true);
    persistTaskNotificationOnlyWhenUnfocused(false);
    assert.equal(isTaskNotificationOnlyWhenUnfocused(), false);
    persistTaskNotificationOnlyWhenUnfocused(true);
    assert.equal(isTaskNotificationOnlyWhenUnfocused(), true);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("Storage unavailable");
      },
    });
    assert.equal(isTaskNotificationOnlyWhenUnfocused(), true);
    assert.doesNotThrow(() => persistTaskNotificationOnlyWhenUnfocused(false));
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
