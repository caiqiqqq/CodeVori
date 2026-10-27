import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddedBrowserSitePermissionController } from "../src/main/embeddedBrowserSitePermissionController.ts";

function createFixture() {
  let saved: Record<string, Record<string, "allow" | "deny">> = {};
  const prompts: Array<{ requestId: string; hostId: number }> = [];
  const closed: string[] = [];
  const controller = createEmbeddedBrowserSitePermissionController({
    load: async () => saved,
    save: async (next) => {
      saved = structuredClone(next);
    },
    sendPrompt: (hostId, prompt) => {
      prompts.push({ requestId: prompt.requestId, hostId });
      return true;
    },
    timeoutMs: 1000,
    onPromptClosed: (_hostId, requestId) => closed.push(requestId),
  });
  return { controller, prompts, closed, getSaved: () => saved };
}

test("sensitive permission needs an answer from the owning window", async () => {
  const { controller, prompts, getSaved } = createFixture();
  await controller.load();
  const decision = controller.request("https://example.com/page", "media", 7, 19, ["audio"]);
  assert.equal(prompts.length, 1);
  assert.equal(controller.resolve(8, prompts[0]!.requestId, "allow-always"), false);
  assert.equal(controller.resolve(7, prompts[0]!.requestId, "allow-always"), true);
  assert.equal(await decision, true);
  assert.equal(controller.check("https://example.com", "media", "audio"), true);
  assert.equal(controller.check("https://example.com", "media", "video"), false);
  assert.equal(getSaved()["https://example.com"]?.["media:audio"], "allow");
});

test("invalid origin and unknown permission fail closed", async () => {
  const { controller, prompts } = createFixture();
  await controller.load();
  assert.equal(await controller.request("file:///tmp/page", "media", 7, 19), false);
  assert.equal(await controller.request("https://example.com", "unknown", 7, 19), false);
  assert.equal(prompts.length, 0);
});

test("session allowance is not persisted and concurrent requests share a prompt", async () => {
  const { controller, prompts, getSaved } = createFixture();
  await controller.load();
  const first = controller.request("https://example.com", "geolocation", 7, 19);
  const second = controller.request("https://example.com", "geolocation", 7, 19);
  assert.equal(prompts.length, 1);
  assert.equal(controller.resolve(7, prompts[0]!.requestId, "allow-session"), true);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(getSaved(), {});
  assert.equal(controller.check("https://example.com", "geolocation"), true);
});

test("settings changes and clear use the same record as permission checks", async () => {
  const { controller } = createFixture();
  await controller.load();
  await controller.set("https://example.com", "media:audio", "deny");
  assert.equal(controller.check("https://example.com", "media", "audio"), false);
  assert.equal(controller.snapshot()["https://example.com"]?.["media:audio"], "deny");
  await controller.set("https://example.com", "media:audio", "ask");
  assert.deepEqual(controller.snapshot(), {});
  await assert.rejects(controller.set("javascript:alert(1)", "media", "allow"));
});

test("a reset invalidates outstanding permission prompts", async () => {
  const { controller, prompts, closed } = createFixture();
  await controller.load();
  const decision = controller.request("https://example.com", "geolocation", 7, 19);
  await controller.clear();
  assert.deepEqual(closed, [prompts[0]!.requestId]);
  assert.equal(controller.resolve(7, prompts[0]!.requestId, "allow-session"), false);
  assert.equal(await decision, false);
  assert.equal(controller.check("https://example.com", "geolocation"), false);
});

test("malformed stored grants are ignored and media capabilities stay separate", async () => {
  const controller = createEmbeddedBrowserSitePermissionController({
    load: async () => ({
      "file:///tmp/page": { media: "allow" },
      "https://example.com": {
        media: "allow",
        "media:audio": "allow",
        unknown: "allow",
        geolocation: "invalid",
      },
    }),
    save: async () => {},
    sendPrompt: () => false,
  });
  await controller.load();
  assert.equal(controller.check("https://example.com", "media", "audio"), true);
  assert.equal(controller.check("https://example.com", "media", "video"), false);
  assert.equal(controller.check("https://example.com", "media"), false);
  assert.equal(
    await controller.request("https://example.com", "media", 7, 19, ["audio", "video"]),
    false,
  );
  assert.deepEqual(controller.snapshot(), { "https://example.com": { "media:audio": "allow" } });
});

test("failed persistence denies approval and queued settings writes do not race", async () => {
  let fail = true;
  let activeWrites = 0;
  let maxWrites = 0;
  let requestId = "";
  const controller = createEmbeddedBrowserSitePermissionController({
    load: async () => ({}),
    save: async () => {
      activeWrites += 1;
      maxWrites = Math.max(maxWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeWrites -= 1;
      if (fail) throw new Error("disk unavailable");
    },
    sendPrompt: (_host, prompt) => {
      requestId = prompt.requestId;
      return true;
    },
  });
  const decision = controller.request("https://example.com", "geolocation", 7, 19);
  controller.resolve(7, requestId, "allow-always");
  assert.equal(await decision, false);
  assert.equal(controller.check("https://example.com", "geolocation"), false);
  fail = false;
  await Promise.all([
    controller.set("https://example.com", "geolocation", "allow"),
    controller.set("https://other.example", "notifications", "deny"),
  ]);
  assert.equal(maxWrites, 1);
  assert.equal(Object.keys(controller.snapshot()).length, 2);
});

test("missing window and unanswered prompt deny", async () => {
  for (const send of [false, true]) {
    const controller = createEmbeddedBrowserSitePermissionController({
      load: async () => ({}),
      save: async () => {},
      sendPrompt: () => send,
      timeoutMs: 5,
    });
    assert.equal(await controller.request("https://example.com", "notifications", 7, 19), false);
  }
});
