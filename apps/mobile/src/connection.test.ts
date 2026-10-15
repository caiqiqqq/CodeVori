import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthenticatedUrl, isSameOrigin, parseConnectionInput } from "./connection";

test("accepts a LAN HTTP origin and builds a token URL", () => {
  const result = parseConnectionInput(" http://192.168.1.23:3030/ ", "lan-secret");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.connection.origin, "http://192.168.1.23:3030/");
  assert.equal(
    buildAuthenticatedUrl(result.connection),
    "http://192.168.1.23:3030/?token=lan-secret",
  );
});

test("rejects credentials, fragments, and missing tokens", () => {
  assert.equal(parseConnectionInput("http://user@192.168.1.23:3030", "secret").ok, false);
  assert.equal(parseConnectionInput("http://192.168.1.23:3030/#fragment", "secret").ok, false);
  assert.equal(parseConnectionInput("http://192.168.1.23:3030/?token=secret", "secret").ok, false);
  assert.equal(parseConnectionInput("http://192.168.1.23:3030/remote", "secret").ok, false);
  assert.equal(parseConnectionInput("http://example.com:3030/", "secret").ok, false);
  assert.equal(parseConnectionInput("http://192.168.1.23:3030", " ").ok, false);
});

test("keeps WebView navigation on the configured origin", () => {
  assert.equal(
    isSameOrigin("http://192.168.1.23:3030/api/server-info", "http://192.168.1.23:3030/"),
    true,
  );
  assert.equal(isSameOrigin("https://example.com/", "http://192.168.1.23:3030/"), false);
});
