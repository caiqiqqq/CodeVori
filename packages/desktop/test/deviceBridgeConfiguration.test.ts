import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDeviceBridgeConfigurationStore } from "../src/main/deviceBridgeConfiguration.js";

test("configuration migrates existing nodes without mistaking first install or explicit stop for enabled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bridge-remember-"));
  try {
    const store = createDeviceBridgeConfigurationStore(directory, "/synthetic/app-v2/bridge");
    assert.deepEqual(await store.readConfiguration(), {
      binaryPath: "/synthetic/app-v2/bridge",
      allowedNodes: [],
      networkingEnabled: false,
    });
    await store.writeConfiguration({
      binaryPath: "/synthetic/app-v2/bridge",
      allowedNodes: [],
      networkingEnabled: true,
    });
    const nextVersion = createDeviceBridgeConfigurationStore(directory, "/synthetic/app-v3/bridge");
    assert.deepEqual(await nextVersion.readConfiguration(), {
      binaryPath: "/synthetic/app-v3/bridge",
      allowedNodes: [],
      networkingEnabled: true,
    });
    // 旧版未写出设置文件时，也应根据已有节点迁移。
    await rm(join(directory, "settings.json"));
    await mkdir(join(directory, "node"));
    const state = join(directory, "node", "tailscaled.state");
    await writeFile(state, "synthetic-private-node-state");
    assert.equal((await store.readConfiguration()).networkingEnabled, true);
    await writeFile(
      join(directory, "settings.json"),
      JSON.stringify({ binaryPath: "/synthetic/custom", allowedNodes: ["peer"] }),
    );
    assert.equal((await store.readConfiguration()).networkingEnabled, true);
    await store.writeConfiguration({
      binaryPath: "/synthetic/custom",
      allowedNodes: ["peer"],
      networkingEnabled: false,
    });
    const updated = createDeviceBridgeConfigurationStore(directory, "/synthetic/app-v3/bridge");
    assert.equal((await updated.readConfiguration()).networkingEnabled, false);
    assert.equal((await updated.readConfiguration()).binaryPath, "/synthetic/custom");
    assert.equal(await readFile(state, "utf8"), "synthetic-private-node-state");
    assert.equal(
      (await readFile(join(directory, "settings.json"), "utf8")).includes("private"),
      false,
    );
    await writeFile(join(directory, "settings.json"), "invalid-json");
    await assert.rejects(store.readConfiguration(), /configuration_unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
