import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";

test("Gemini 供应商绑定在目标 Host 重启后读取最新凭据，不保留旧模型或改写其它 Agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-gemini-provider-"));
  const bin = join(root, "bin");
  const directory = join(root, "agents");
  const options = { directory, env: { PATH: bin, HOME: root, GEMINI_MODEL: "inherited" } };
  const manager = createAcpAgentManager(options);
  const other = createAcpAgentManager({ ...options, directory: join(root, "other-host") });
  const provider = {
    id: randomUUID(),
    name: "测试供应商",
    apiUrl: "https://gemini.invalid",
    apiKey: "fake-first",
    model: "first-model",
  };
  try {
    await mkdir(bin);
    await writeFile(join(bin, "gemini"), "#!/bin/sh\necho 0.59.0\n", { mode: 0o755 });
    const empty = await manager.listGeminiProviders();
    const saved = await manager.updateGeminiProviders({
      expectedVersion: empty.version,
      action: "upsert",
      provider,
    });
    assert.equal((await other.listGeminiProviders()).providers.length, 0);
    await manager.updateAgent({ agent: "claude", env: { ANTHROPIC_API_KEY: "unrelated" } });
    const claudeBefore = await readFile(join(directory, "claude.json"), "utf8");
    const updated = await manager.updateAgent({
      agent: "gemini",
      env: {
        ZCODE_GEMINI_AUTH_MODE: "model_provider",
        ZCODE_GEMINI_PROVIDER_ID: provider.id,
        GEMINI_API_KEY: "stale",
        GOOGLE_API_KEY: "stale",
        GEMINI_MODEL: "stale",
        EXTRA: "keep",
      },
    });
    assert.equal(updated.env.GEMINI_API_KEY, undefined);
    assert.equal(updated.env.GEMINI_MODEL, undefined);
    assert.equal(updated.env.ZCODE_GEMINI_PROVIDER_ID, provider.id);
    assert.equal((await stat(join(directory, "gemini-providers.json"))).mode & 0o777, 0o600);
    const restarted = createAcpAgentManager(options);
    try {
      const first = await restarted.resolveLaunch("gemini");
      assert.equal(first.env.GEMINI_API_KEY, provider.apiKey);
      assert.equal(first.env.GOOGLE_GEMINI_BASE_URL, provider.apiUrl);
      assert.equal(first.env.GEMINI_MODEL, provider.model);
      assert.equal(first.env.GOOGLE_API_KEY, undefined);
      assert.equal(first.env.ZCODE_GEMINI_PROVIDER_ID, undefined);
      assert.equal(first.env.EXTRA, "keep");
      assert.equal(
        JSON.parse(await readFile(join(root, ".gemini/settings.json"), "utf8")).security.auth
          .selectedType,
        "gateway",
      );
      const changed = await manager.updateGeminiProviders({
        expectedVersion: saved.version,
        action: "upsert",
        provider: { ...provider, apiKey: "fake-second", apiUrl: "https://new.invalid", model: "" },
      });
      const second = await restarted.resolveLaunch("gemini");
      assert.equal(second.env.GEMINI_API_KEY, "fake-second");
      assert.equal(second.env.GOOGLE_GEMINI_BASE_URL, "https://new.invalid");
      assert.equal(second.env.GEMINI_MODEL, undefined);
      assert.equal(first.env.GEMINI_API_KEY, "fake-first", "现有连接启动环境不变");
      await assert.rejects(
        manager.updateGeminiProviders({
          expectedVersion: saved.version,
          action: "delete",
          id: provider.id,
        }),
        /版本|刷新/,
      );
      await manager.updateGeminiProviders({
        expectedVersion: changed.version,
        action: "delete",
        id: provider.id,
      });
      await assert.rejects(restarted.resolveLaunch("gemini"), /供应商/);
      await assert.rejects(
        manager.updateAgent({ agent: "gemini", env: { ZCODE_GEMINI_AUTH_MODE: "model_provider" } }),
        /供应商/,
      );
      await assert.rejects(
        manager.updateAgent({
          agent: "gemini",
          env: { ZCODE_GEMINI_AUTH_MODE: "model_provider", ZCODE_GEMINI_PROVIDER_ID: randomUUID() },
        }),
        /供应商/,
      );
      const unbound = await manager.updateAgent({
        agent: "gemini",
        env: { ZCODE_GEMINI_AUTH_MODE: "login_google", ZCODE_GEMINI_PROVIDER_ID: provider.id },
      });
      assert.equal(unbound.env.ZCODE_GEMINI_PROVIDER_ID, undefined);
      assert.equal(await readFile(join(directory, "claude.json"), "utf8"), claudeBefore);
    } finally {
      restarted.dispose();
    }
  } finally {
    manager.dispose();
    other.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Gemini 供应商目录并发旧版本和损坏文件拒绝覆盖", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-gemini-provider-cas-"));
  const manager = createAcpAgentManager({ directory, env: { PATH: "" } });
  const secondHost = createAcpAgentManager({ directory, env: { PATH: "" } });
  const provider = {
    id: randomUUID(),
    name: "测试",
    apiUrl: "https://gemini.invalid",
    apiKey: "fake",
    model: "",
  };
  try {
    const initial = await manager.listGeminiProviders();
    const results = await Promise.allSettled(
      [manager, secondHost].map((host, index) =>
        host.updateGeminiProviders({
          action: "upsert",
          expectedVersion: initial.version,
          provider: { ...provider, name: `测试 ${index}` },
        }),
      ),
    );
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal((await manager.listGeminiProviders()).providers.length, 1);
    const path = join(directory, "gemini-providers.json");
    await writeFile(path, "invalid-json");
    await assert.rejects(manager.listGeminiProviders(), /供应商/);
    await assert.rejects(
      manager.updateGeminiProviders({
        expectedVersion: initial.version,
        action: "upsert",
        provider,
      }),
      /供应商/,
    );
    assert.equal(await readFile(path, "utf8"), "invalid-json");
  } finally {
    manager.dispose();
    secondHost.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
