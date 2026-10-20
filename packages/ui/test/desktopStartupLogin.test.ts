import assert from "node:assert/strict";
import test from "node:test";
import { shouldRequireStartupLogin } from "../src/lib/rootStartupGate.js";
import { applyCachedOAuthSessionRestoreResult } from "../src/root/oauthCachedSessionRestore.js";
import {
  consumeZcodeJwtInvalidRestartMarker,
  markZcodeJwtInvalidRestart,
} from "../src/root/zcodeJwtInvalidRestartMarker.js";

test("Desktop startup does not require login, while Web retains its provider gate", () => {
  assert.equal(shouldRequireStartupLogin(true), false);
  assert.equal(shouldRequireStartupLogin(false), true);
  assert.equal(shouldRequireStartupLogin(undefined), true);
});

test("an expired JWT restart marker is consumed once without gating Desktop startup", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  markZcodeJwtInvalidRestart(storage);

  assert.equal(consumeZcodeJwtInvalidRestartMarker(storage), true);
  assert.equal(shouldRequireStartupLogin(true), false);
  assert.equal(consumeZcodeJwtInvalidRestartMarker(storage), false);
});

test("Desktop clears expired cached identity without a startup login prompt", async () => {
  let user: string | null = "previous user";
  let alerts = 0;
  let loginRequests = 0;
  const restored = await applyCachedOAuthSessionRestoreResult({
    result: { status: "reauthentication-required", reason: "jwt-expired" },
    setUser: (value) => {
      user = value?.id ?? null;
    },
    requestAlert: async () => {
      alerts++;
      return true;
    },
    onReauthenticationRequired: () => {
      loginRequests++;
    },
    copy: { title: "Session expired" },
    requireStartupLogin: false,
  });

  assert.equal(restored, false);
  assert.equal(user, null);
  assert.equal(alerts, 0);
  assert.equal(loginRequests, 0);
});

test("Web still prompts and routes an expired cached identity to login", async () => {
  let alerts = 0;
  let loginRequests = 0;
  const restored = await applyCachedOAuthSessionRestoreResult({
    result: { status: "reauthentication-required", reason: "jwt-expired" },
    setUser: (user) => assert.equal(user, null),
    requestAlert: async () => {
      alerts++;
      return true;
    },
    onReauthenticationRequired: () => {
      loginRequests++;
    },
    copy: { title: "Session expired" },
    requireStartupLogin: true,
  });

  assert.equal(restored, false);
  assert.equal(alerts, 1);
  assert.equal(loginRequests, 1);
});
