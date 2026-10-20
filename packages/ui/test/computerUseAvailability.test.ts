import assert from "node:assert/strict";
import test from "node:test";
import { buildRemoteWorkspaceIdentity } from "@zcode/shared";
import { resolveComputerUseAvailability } from "../src/settings/computerUseAvailability.js";
import { supportsLocalWindowsCuaEntry } from "../src/lib/cuaPlatform.js";

test("open computer control is macOS-only and never borrows a local capability for remote", () => {
  assert.equal(
    resolveComputerUseAvailability({ isDesktop: true, isMacDesktop: true }).supported,
    true,
  );
  for (const options of [
    {},
    { isDesktop: true },
    { isDesktop: true, isWindowsDesktop: true },
    { isDesktop: true, isMacDesktop: true, remoteSessionId: "remote-fixture" },
    {
      isDesktop: true,
      isMacDesktop: true,
      workspaceIdentity: buildRemoteWorkspaceIdentity("/fixture", {
        kind: "docker",
        container: "fixture",
      }),
    },
  ])
    assert.equal(resolveComputerUseAvailability(options).supported, false);
  assert.equal(
    supportsLocalWindowsCuaEntry({ executeDesktopCommand: async () => undefined }),
    false,
  );
});
