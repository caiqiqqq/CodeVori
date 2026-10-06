import assert from "node:assert/strict";
import test from "node:test";
import { readOpenComputerUsePermissions, resolveOpenComputerUseNative } from "../open-native.mjs";

const options = {
  platform: "darwin",
  macOsVersion: "14.0",
  executable: process.execPath,
  env: { ZCODE_OPEN_CUA_PERMISSION_APP_PATH: "/Applications/Example.app" },
  runUtility: async () => ({ accessibility: true, screenRecording: true }),
};

test("normal permission queries never capture; explicit granted queries may probe", async () => {
  let probes = 0;
  const probe = async () => {
    probes++;
    return true;
  };
  const normal = await readOpenComputerUsePermissions({ ...options, probe });
  assert.equal(normal.available, true);
  assert.equal(normal.grantOwnerDisplayName, "Example");
  assert.equal(normal.accessibility, "granted");
  assert.equal(normal.screenCaptureProbeOk, false);
  assert.equal(probes, 0);
  assert.equal(
    (await readOpenComputerUsePermissions({ ...options, probe, probeScreenCapture: true }))
      .screenCaptureProbeOk,
    true,
  );
  assert.equal(probes, 1);
  await readOpenComputerUsePermissions({
    ...options,
    probe,
    probeScreenCapture: true,
    runUtility: async () => ({ accessibility: false, screenRecording: false }),
  });
  assert.equal(probes, 1);
});

test("permission checks fail closed for unsupported, missing and malformed native", async () => {
  for (const extra of [
    { platform: "win32" },
    { macOsVersion: "13.5" },
    { executable: "/nonexistent/open-cua-native" },
    { runUtility: async () => ({ accessibility: "true", screenRecording: true }) },
  ])
    assert.equal((await readOpenComputerUsePermissions({ ...options, ...extra })).available, false);
  const result = await readOpenComputerUsePermissions({
    ...options,
    probeScreenCapture: true,
    probe: async () => {
      throw new Error("capture failed");
    },
  });
  assert.equal(result.screenCaptureProbeOk, false);
});

test("legacy executable and pointer overrides do not select the builtin native", () => {
  const result = resolveOpenComputerUseNative({
    env: { OPEN_ZCODE_CUA_NATIVE: "/untrusted/executable" },
    arch: "arm64",
  });
  assert.ok(result.endsWith("native-bin/darwin-arm64/OpenZCodeNative"));
  assert.equal(
    resolveOpenComputerUseNative({ env: { ZCODE_OPEN_CUA_NATIVE: process.execPath } }),
    process.execPath,
  );
});
