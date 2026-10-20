import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ACP_AGENT_CATALOG, ACP_AGENT_MODEL_ENV, type AcpConfigOption } from "@zcode/shared";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

test("all non-Codex defaults persist in one location and survive unrelated updates and clearing", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-default-models-"));
  let manager = createAcpAgentManager({ directory: root, env: { PATH: "" } });
  try {
    for (const { id: agent } of ACP_AGENT_CATALOG) {
      if (agent === "codex") continue;
      await manager.updateAgent({ agent, env: { EXTRA: "keep" }, defaultModel: "selected" });
      await manager.updateAgent({ agent, enabled: false });
    }
    manager.dispose();
    manager = createAcpAgentManager({ directory: root, env: { PATH: "" } });
    const infos = await manager.listAgents();
    for (const info of infos) {
      if (info.agent === "codex") continue;
      assert.equal(info.defaultModel, "selected");
      assert.equal(info.defaultModelSupported, true);
      assert.equal(info.enabled, false);
      const raw = JSON.parse(await readFile(join(root, `${info.agent}.json`), "utf8"));
      const key = ACP_AGENT_MODEL_ENV[info.agent];
      assert.equal(raw.env.EXTRA, "keep");
      if (key) {
        assert.equal(raw.env[key], "selected");
        assert.equal(raw.defaultModel, undefined);
      } else {
        assert.equal(raw.defaultModel, "selected");
        assert.deepEqual(raw.env, { EXTRA: "keep" });
      }
      const cleared = await manager.updateAgent({ agent: info.agent, defaultModel: "" });
      assert.equal(cleared.defaultModel, "");
      assert.equal(cleared.env.EXTRA, "keep");
    }
    await assert.rejects(manager.updateAgent({ agent: "codex", defaultModel: "invalid" }), /Codex/);
    const providers = await manager.listGeminiProviders();
    await manager.updateGeminiProviders({
      action: "upsert",
      expectedVersion: providers.version,
      provider: {
        id: "123e4567-e89b-42d3-a456-426614174001",
        name: "Fixture",
        apiUrl: "https://example.invalid",
        apiKey: "fake-key",
        model: "provider-model",
      },
    });
    await manager.updateAgent({
      agent: "gemini",
      env: {
        ZCODE_GEMINI_AUTH_MODE: "model_provider",
        ZCODE_GEMINI_PROVIDER_ID: "123e4567-e89b-42d3-a456-426614174001",
      },
    });
    await assert.rejects(
      manager.updateAgent({ agent: "gemini", defaultModel: "conflicting" }),
      /供应商配置/,
    );
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP defaults apply before a new session is ready; reconnect preserves session choice and stale defaults fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-default-handshake-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  await symlink(process.execPath, join(bin, "qoder"));
  await symlink(process.execPath, join(bin, "node"));
  const manager = createAcpAgentManager({ directory: join(root, "settings"), env: { PATH: bin } });
  const calls: string[] = [];
  const exits = new Map<string, (reason: string) => void>();
  let available = ["base", "selected"];
  let reject = false;
  let ignored = false;
  let closed = 0;
  let count = 0;
  const connect: AcpConnectionFactory = async ({ sessionId, onExit }) => {
    const id = sessionId ?? `native-${++count}`;
    exits.set(id, onExit);
    let options: AcpConfigOption[] = [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "base",
        options: available.map((value) => ({ value, name: value })),
      },
    ];
    return {
      sessionId: id,
      configOptions: options,
      modeState: null,
      async setConfigOption(id, value) {
        calls.push(`${id}:${value}`);
        if (reject) throw new Error("fixture rejected");
        if (!ignored)
          options = options.map((item) => ({ ...item, currentValue: value }) as AcpConfigOption);
        return options;
      },
      async setMode() {},
      async prompt() {
        throw new Error("Must not prompt");
      },
      async cancel() {},
      close() {
        closed++;
      },
    };
  };
  const service = createAcpService({
    directory: join(root, "sessions"),
    agentManager: manager,
    connect,
  });
  const target = { workspacePath: "/fixture/default-models" };
  try {
    const original = await service.create({ ...target, agent: "qoder" });
    await assert.rejects(
      service.updateAgent({ agent: "qoder", defaultModel: "unknown" }),
      /已知 ACP/,
    );
    await service.updateAgent({ agent: "qoder", defaultModel: "selected" });
    const second = await service.create({ ...target, agent: "qoder" });
    assert.equal(second.configOptions[0]?.currentValue, "selected");
    assert.deepEqual(calls, ["model:selected"]);
    exits.get(original.acpSessionId!)!("fixture disconnect");
    const restored = await service.refresh({ ...target, id: original.id });
    assert.equal(restored.configOptions[0]?.currentValue, "base");
    assert.deepEqual(
      calls,
      ["model:selected"],
      "New preference cannot overwrite an existing session",
    );
    available = ["base"];
    await assert.rejects(service.create({ ...target, agent: "qoder" }), /默认模型不在/);
    available = ["base", "selected"];
    reject = true;
    await assert.rejects(service.create({ ...target, agent: "qoder" }), /could not be restored/);
    reject = false;
    ignored = true;
    await assert.rejects(service.create({ ...target, agent: "qoder" }), /could not be restored/);
    assert.ok(closed >= 3, "Failed connections are closed");
    ignored = false;
    await service.updateAgent({ agent: "qoder", defaultModel: "" });
    const cleared = await service.create({ ...target, agent: "qoder" });
    assert.equal(cleared.configOptions[0]?.currentValue, "base");
  } finally {
    await service.disposeAllAndWait();
    await rm(root, { recursive: true, force: true });
  }
});
