import assert from "node:assert/strict";
import test from "node:test";
import { buildRemoteWorkspaceIdentity } from "@zcode/shared";
import { createOpenCuaPermissionService } from "../src/cua-permission-broker/openCuaPermissionService.js";

test("open permission adapter preserves UI functional-probe intent without background capture", async () => {
  const queries: boolean[] = [];
  let refreshes = 0;
  const service = createOpenCuaPermissionService({
    serviceAuthorityMode: "desktop-local",
    readPermissions: async (options) => {
      queries.push(options?.probeScreenCapture === true);
      return {
        available: true,
        grantOwner: "Example",
        accessibility: "granted",
        screenRecording: "granted",
        screenCaptureProbeOk: options?.probeScreenCapture === true,
      };
    },
    refreshPermissions: async () => {
      refreshes += 1;
    },
  });
  await service.getStatus("/synthetic/project");
  await service.getStatus("/synthetic/project", undefined, { includeFunctionalProbes: false });
  await service.getStatus("/synthetic/project", undefined, { includeFunctionalProbes: true });
  await service.getStatus("/synthetic/project", undefined, { probeScreenCapture: true });
  await service.getStatus("/synthetic/project", undefined, {
    includeFunctionalProbes: true,
    probeScreenCapture: false,
  });
  assert.deepEqual(queries, [false, false, true, true, false]);
  assert.equal((await service.restartHelper("/synthetic/project")).ok, true);
  assert.equal(refreshes, 1);
});

test("remote identities and nonlocal service authority cannot check or refresh the desktop", async () => {
  for (const serviceAuthorityMode of [undefined, "local-server", "desktop-local"] as const) {
    let calls = 0;
    const service = createOpenCuaPermissionService({
      serviceAuthorityMode,
      readPermissions: async () => {
        calls += 1;
        throw new Error("must not query");
      },
      refreshPermissions: async () => {
        calls += 1;
      },
    });
    const identity =
      serviceAuthorityMode === "desktop-local"
        ? buildRemoteWorkspaceIdentity("/synthetic/project", {
            kind: "docker",
            container: "fixture",
          })
        : undefined;
    assert.equal((await service.getStatus("/synthetic/project", identity)).available, false);
    assert.equal((await service.restartHelper("/synthetic/project", identity)).ok, false);
    assert.equal(calls, 0);
  }
});

test("permission refresh failures remain user-visible", async () => {
  const service = createOpenCuaPermissionService({
    serviceAuthorityMode: "desktop-local",
    refreshPermissions: async () => {
      throw new Error("refresh failed");
    },
  });
  assert.deepEqual(await service.restartHelper("/synthetic/project"), {
    ok: false,
    reason: "refresh failed",
  });
});
