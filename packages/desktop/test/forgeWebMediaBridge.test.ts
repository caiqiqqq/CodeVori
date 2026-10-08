import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostIncomingMessageSchema as hostMessageSchema,
  hostResponseMessageSchema as hostResponseSchema,
  type ForgeWebMediaContext,
  type HostForgeWebMediaRequest,
} from "@zcode/shared";
import { createForgeWebMediaMainBridge } from "../src/host/forgeWebMediaMainBridge.js";

const context: ForgeWebMediaContext = {
  accountId: "3c88bcca-98b9-4aaa-9c0c-2f869f0c1b01",
  username: "synthetic-user",
  serverUrl: "https://forge.example.invalid",
  repository: "team/project",
  repositoryUrl: "https://forge.example.invalid/team/project",
  url: "https://forge.example.invalid/team/project/uploads/0123456789abcdef0123456789abcdef/image.png",
  loginUrl: "https://forge.example.invalid/users/sign_in",
};
test("native requests and responses validate inside the existing Host discriminated unions", () => {
  const requestId = "4c88bcca-98b9-4aaa-9c0c-2f869f0c1b01";
  for (const action of ["read", "authenticate"] as const)
    assert.equal(
      hostResponseSchema.safeParse({ type: "forge-web-media-request", requestId, action, context })
        .success,
      true,
    );
  assert.equal(
    hostResponseSchema.safeParse({ type: "forge-web-media-request", requestId, action: "cancel" })
      .success,
    true,
  );
  assert.equal(
    hostMessageSchema.safeParse({ type: "forge-web-media-result", requestId, ok: true }).success,
    true,
  );
  assert.equal(
    hostResponseSchema.safeParse({
      type: "forge-web-media-request",
      requestId,
      action: "read",
      context: { ...context, secret: "synthetic-secret" },
    }).success,
    false,
  );
  assert.equal(
    hostMessageSchema.safeParse({
      type: "forge-web-media-result",
      requestId,
      ok: false,
      error: "raw credential data",
    }).success,
    false,
  );
});

test("concurrent same-account logins share one native command and settle all callers", async () => {
  const messages: HostForgeWebMediaRequest[] = [];
  const bridge = createForgeWebMediaMainBridge((message) => messages.push(message));
  try {
    const first = bridge.port.authenticate(context);
    const second = bridge.port.authenticate({
      ...context,
      url: context.url.replace("image.png", "other.png"),
    });
    assert.equal(messages.length, 1);
    bridge.handleResult({
      type: "forge-web-media-result",
      requestId: messages[0]!.requestId,
      ok: true,
    });
    await Promise.all([first, second]);
    const next = bridge.port.authenticate(context);
    assert.equal(
      messages.length,
      2,
      "Settled authorization admission does not become a durable cache",
    );
    bridge.handleResult({
      type: "forge-web-media-result",
      requestId: messages[1]!.requestId,
      ok: true,
    });
    await next;
  } finally {
    bridge.dispose();
  }
});

test("correlation ignores late/unknown results, validates read payloads, and rejects on disposal", async () => {
  const messages: HostForgeWebMediaRequest[] = [];
  const bridge = createForgeWebMediaMainBridge((message) => messages.push(message));
  const failedRead = assert.rejects(bridge.port.read(context), /FORGE_RESPONSE/);
  bridge.handleResult({ type: "forge-web-media-result", requestId: context.accountId, ok: true });
  bridge.handleResult({
    type: "forge-web-media-result",
    requestId: messages[0]!.requestId,
    ok: true,
  });
  await failedRead;
  const failedAuth = assert.rejects(
    bridge.port.authenticate(context),
    /FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE/,
  );
  bridge.dispose();
  await failedAuth;
  assert.equal(messages.at(-1)!.action, "cancel");
  bridge.handleResult({
    type: "forge-web-media-result",
    requestId: messages[1]!.requestId,
    ok: true,
  });
  await assert.rejects(bridge.port.authenticate(context), /FORGE_MEDIA_AUTHENTICATION_UNAVAILABLE/);
});
