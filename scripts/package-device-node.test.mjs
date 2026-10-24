import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  deviceNodeBuildPlan,
  validateBuildServiceUrl,
  deviceNodeReleaseManifest,
} from "./package-device-node.mjs";

test("update manifest pins versioned client URLs independently of the desktop version", () => {
  const manifest = deviceNodeReleaseManifest({
    version: "0.0.6",
    source: "head",
    dirty: false,
    serviceUrl: "https://service.test/nodes",
    assetsBaseUrl: "https://files.test/clients",
    files: [
      { platform: "win32-x64", name: "CodeVoriNode-win32-x64.exe", bytes: 123, sha256: "abc" },
    ],
  });
  assert.equal(
    manifest.files[0].url,
    "https://files.test/clients/0.0.6/CodeVoriNode-win32-x64.exe",
  );
  assert.equal(manifest.transport, "tailscale");
  assert.equal(manifest.serviceUrl, "https://service.test/nodes");
  assert.throws(() => deviceNodeReleaseManifest({ version: "../other", files: [] }));
});

test("Tailscale clients cover all six platforms without relay service assets", () => {
  const plan = deviceNodeBuildPlan("0.0.5", "/artifacts");
  assert.equal(plan.clients, "/artifacts/clients/0.0.5");
  assert.equal("services" in plan, false);
  assert.equal(plan.clientTargets.length, 6);
  assert.equal("serviceTargets" in plan, false);
  assert.equal(
    deviceNodeBuildPlan("0.0.7", "output/ci").clients,
    resolve("output/ci/clients/0.0.7"),
  );
});

test("local builds require explicit loopback selection; release builds require HTTPS", () => {
  assert.equal(validateBuildServiceUrl("http://127.0.0.1:18081", true), "http://127.0.0.1:18081");
  assert.equal(
    validateBuildServiceUrl("https://example.test/nodes/"),
    "https://example.test/nodes",
  );
  for (const url of [
    "http://127.0.0.1:18081",
    "http://192.168.1.2:18081",
    "https://a:b@example.test",
    "https://example.test/?token=x",
  ]) {
    assert.throws(() => validateBuildServiceUrl(url));
  }
  for (const url of [
    "http://192.168.1.2:18081",
    "https://example.test",
    "http://127.0.0.1:18081/?x=y",
  ]) {
    assert.throws(() => validateBuildServiceUrl(url, true));
  }
});
