import assert from "node:assert/strict";
import test from "node:test";
import { buildRemoteWorkspaceIdentity } from "@zcode/shared";
import { resolveComputerUseAvailability } from "../src/settings/computerUseAvailability.js";
import { supportsLocalWindowsCuaEntry } from "../src/lib/cuaPlatform.js";

test("computer control supports macOS and Windows and never borrows a local capability for remote", () => {
  assert.equal(
    resolveComputerUseAvailability({ isDesktop: true, isMacDesktop: true }).supported,
    true,
  );
  assert.equal(
    resolveComputerUseAvailability({ isDesktop: true, isWindowsDesktop: true }).supported,
    true,
  );
  for (const options of [
    {},
    { isDesktop: true },
    { isDesktop: true, isWindowsDesktop: true, remoteSessionId: "remote-fixture" },
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

test("Windows composer entry requires both native desktop IPC and Windows UA", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    assert.equal(
      supportsLocalWindowsCuaEntry({ executeDesktopCommand: async () => undefined }),
      true,
    );
    assert.equal(supportsLocalWindowsCuaEntry({}), false);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
