import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthenticatedUrl,
  isSameOrigin,
  parseConnectionInput,
  parsePairingInput,
  parsePairingLink,
} from "./connection";

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
  assert.equal(parseConnectionInput("http://192.168.1.23:3030", " ").ok, false);
});

test("keeps WebView navigation on the configured origin", () => {
  assert.equal(
    isSameOrigin("http://192.168.1.23:3030/api/server-info", "http://192.168.1.23:3030/"),
    true,
  );
  assert.equal(isSameOrigin("https://example.com/", "http://192.168.1.23:3030/"), false);
});

test("pasted links and scanned QR codes preserve an encoded token", () => {
  const expected = { origin: "http://192.168.1.23:3030/", token: "test+/=&凭据" };
  const link = buildAuthenticatedUrl(expected);
  assert.deepEqual(parsePairingLink(` ${link} `), { ok: true, connection: expected });
  assert.deepEqual(parsePairingInput(link, ""), { ok: true, connection: expected });
  assert.deepEqual(parsePairingInput(link, expected.token), { ok: true, connection: expected });
  assert.equal(parsePairingInput(link, "different-token").ok, false);
  assert.deepEqual(parsePairingInput(expected.origin, expected.token), {
    ok: true,
    connection: expected,
  });
  assert.equal(parsePairingLink("https://zcode.test/?token=test").ok, true);
  assert.equal(parsePairingLink("http://desktop.local:3030/?token=test").ok, true);
});

test("invalid QR codes cannot change the origin or sneak in unsupported parameters", () => {
  for (const address of [
    "http://192.168.1.23:3030/",
    "http://192.168.1.23:3030/?token=",
    "http://192.168.1.23:3030/?token=%20",
    "http://192.168.1.23:3030/?token=a&token=b",
    "http://192.168.1.23:3030/?token=a&redirect=https://example.test",
    "http://192.168.1.23:3030/?token=a#fragment",
    "http://user:password@192.168.1.23:3030/?token=a",
    "http://bad_domain.test/?token=a",
    "https://zcode.z.ai/remote/v4?token=a",
    "exp://192.168.1.23:8081",
    '{"url":"http://192.168.1.23:3030/?token=a"}',
  ]) {
    assert.equal(parsePairingLink(address).ok, false, address);
    if (address.includes("?")) assert.equal(parsePairingInput(address, "a").ok, false, address);
  }
});

test("custom HTTP domains support manual input, pasted links, QR and same-origin navigation", () => {
  for (const address of ["codevori.example.test", "sub.example.com", "desktop.local"]) {
    const connection = { origin: `http://${address}:52235/`, token: "synthetic+/=token" };
    const expected = { ok: true, connection };
    const link = buildAuthenticatedUrl(connection);
    assert.deepEqual(parseConnectionInput(connection.origin, connection.token), expected);
    assert.deepEqual(parsePairingInput(link, ""), expected);
    assert.deepEqual(parsePairingLink(link), expected);
    assert.equal(isSameOrigin(`${connection.origin}api/desktop-window`, connection.origin), true);
    assert.equal(isSameOrigin("http://other.example.test:52235/", connection.origin), false);
    assert.equal(parseConnectionInput(connection.origin, "").ok, false);
    assert.equal(parsePairingLink(link + "&extra=1").ok, false);
    assert.equal(parsePairingInput(link, "other-token").ok, false);
    assert.equal(parsePairingLink(`http://user:password@${address}:52235/?token=a`).ok, false);
  }
  for (const host of [
    "bad_domain.test",
    "-bad.test",
    "bad..test",
    "*.example.test",
    "192.168.1.999",
    "0.0.0.0",
    "8.8.8.8",
  ]) {
    assert.equal(parseConnectionInput(`http://${host}:52235`, "token").ok, false, host);
  }
  assert.equal(parseConnectionInput("https://8.8.8.8:52235", "token").ok, true);
});
