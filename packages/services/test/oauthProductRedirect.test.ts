import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopOAuthRedirectUriFromEnv } from "../src/oauth/providers/configUtils.ts";

test("desktop login callback returns to CodeVori without taking ZCode's scheme", () => {
  const url = new URL(buildDesktopOAuthRedirectUriFromEnv({ ZCODE_ENV: "production" }));
  assert.equal(url.searchParams.get("redirect"), "codevori://oauth/callback");
});
