import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  createDeepLinkSingleInstanceData,
  deepLinkProtocolRegistrationArgs,
  extractDeepLinkUrlFromArgs,
  extractDeepLinkUrlFromSingleInstanceData,
} from "../src/main/desktopDeepLinkUrl.ts";

test("Windows protocol registration separates external URLs from app arguments", () => {
  assert.deepEqual(deepLinkProtocolRegistrationArgs("win32"), ["--"]);
  const entry = resolve("project with spaces", "main.js");
  assert.deepEqual(deepLinkProtocolRegistrationArgs("win32", entry), [entry, "--"]);
});

test("other platforms keep their existing protocol registration arguments", () => {
  for (const platform of ["darwin", "linux"] as const) {
    assert.equal(deepLinkProtocolRegistrationArgs(platform), undefined);
    assert.deepEqual(deepLinkProtocolRegistrationArgs(platform, "/app/main.js"), ["/app/main.js"]);
  }
});

test("deep links remain extractable after the argument separator", () => {
  for (const url of [
    "zcode://oauth/callback?code=code%20value&state=state",
    "zcode://workspace/open?path=C%3A%5CProject%20A%26B",
    "zcode://share/import?code=abc_DEF-123",
  ]) {
    const argv = [process.execPath, "--", url];
    assert.equal(extractDeepLinkUrlFromArgs(argv), url);
    assert.equal(
      extractDeepLinkUrlFromSingleInstanceData(createDeepLinkSingleInstanceData(argv)),
      url,
    );
  }
});
