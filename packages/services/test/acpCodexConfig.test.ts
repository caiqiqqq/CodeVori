import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readCodexNativeConfig, updateCodexNativeConfig } from "../src/acp/acpCodexConfig.js";
import { listCodexOfficialModels } from "../src/acp/acpCodexModels.js";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";

test("Codex 原生配置按当前文件补丁保存，保留未知键、注释与订阅 token", async () => {
  const home = await mkdtemp(join(tmpdir(), "zcode-codex-config-"));
  try {
    await writeFile(
      join(home, "config.toml"),
      '# original\nmodel = "old"\nmodel_provider = "other"\n[features]\nskills = true\n[model_providers.other]\nbase_url = "https://other.example/v1"\n',
    );
    await writeFile(
      join(home, "auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "old",
        tokens: { access_token: "fake-token" },
      }),
    );
    const before = await readCodexNativeConfig(home);
    assert.equal(before.apiUrl, "https://other.example/v1");
    assert.equal(before.apiKey, "old");
    const custom = await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: "custom",
      apiUrl: "https://new.example/v1",
      apiKey: "new-secret",
      model: "gpt-test",
    });
    assert.equal(custom.authMode, "custom");
    assert.equal(custom.apiUrl, "https://new.example/v1");
    assert.equal(custom.model, "gpt-test");
    const toml = await readFile(join(home, "config.toml"), "utf8");
    assert.match(toml, /# original/);
    assert.match(toml, /\[features\]\nskills = true/);
    assert.match(toml, /\[model_providers\.other\]\nbase_url = "https:\/\/other\.example\/v1"/);
    assert.match(toml, /\[model_providers\.zcode\]/);
    assert.match(toml, /name = "CodeVori"/);
    const auth = JSON.parse(await readFile(join(home, "auth.json"), "utf8"));
    assert.equal(auth.OPENAI_API_KEY, "new-secret");
    assert.deepEqual(auth.tokens, { access_token: "fake-token" });
    await assert.rejects(
      updateCodexNativeConfig(home, {
        expectedVersion: before.version,
        authMode: "subscription",
        apiUrl: "",
        apiKey: "",
        model: "gpt-test",
      }),
      /已变更/,
    );
    const subscribed = await updateCodexNativeConfig(home, {
      expectedVersion: custom.version,
      authMode: "subscription",
      apiUrl: "",
      apiKey: "",
      model: "gpt-test",
    });
    assert.equal(subscribed.authMode, "subscription");
    assert.equal(subscribed.hasSubscriptionCredentials, true);
    assert.doesNotMatch(await readFile(join(home, "config.toml"), "utf8"), /^model_provider\s*=/m);
    assert.equal(JSON.parse(await readFile(join(home, "auth.json"), "utf8")).OPENAI_API_KEY, null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("损坏的原生文件拒绝覆盖，外部修改触发版本冲突", async () => {
  const home = await mkdtemp(join(tmpdir(), "zcode-codex-invalid-"));
  try {
    await writeFile(join(home, "config.toml"), 'model = "old"\n');
    const before = await readCodexNativeConfig(home);
    await writeFile(join(home, "config.toml"), 'model = "external"\n');
    await assert.rejects(
      updateCodexNativeConfig(home, {
        expectedVersion: before.version,
        authMode: "custom",
        apiUrl: "https://example.test",
        apiKey: "secret",
        model: "new",
      }),
      /已变更/,
    );
    assert.match(await readFile(join(home, "config.toml"), "utf8"), /external/);
    await writeFile(join(home, "auth.json"), "{");
    await assert.rejects(readCodexNativeConfig(home), /auth.json/);
    assert.match(await readFile(join(home, "config.toml"), "utf8"), /external/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("模型目录来自适配器自身依赖，新连接使用原生配置并隔离旧环境变量", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-codex-adapter-"));
  const home = join(root, "codex-home");
  const bin = join(root, "bin");
  try {
    await mkdir(join(root, "adapter", "dist"), { recursive: true });
    await mkdir(join(root, "adapter", "node_modules", "@openai", "codex", "bin"), {
      recursive: true,
    });
    await mkdir(home);
    await mkdir(bin);
    await symlink(process.execPath, join(bin, "node"));
    const adapter = join(root, "adapter", "dist", "index.js");
    await writeFile(adapter, "// fake adapter\n", { mode: 0o755 });
    await symlink(adapter, join(bin, "codex-acp"));
    await writeFile(
      join(root, "adapter", "node_modules", "@openai", "codex", "package.json"),
      JSON.stringify({ name: "@openai/codex", exports: { "./bin/codex.js": "./bin/codex.js" } }),
    );
    await writeFile(
      join(root, "adapter", "node_modules", "@openai", "codex", "bin", "codex.js"),
      'process.stdout.write(JSON.stringify({models:[{slug:"from-adapter",display_name:"Adapter",visibility:"list"},{slug:"hidden",visibility:"hide"}]}));\n',
    );
    assert.deepEqual(await listCodexOfficialModels(adapter, process.execPath, process.env), [
      { slug: "from-adapter", name: "Adapter" },
    ]);
    const manager = createAcpAgentManager({
      directory: join(root, "settings"),
      env: {
        PATH: bin,
        CODEX_HOME: home,
        OPENAI_API_KEY: "obsolete-env-key",
        OPENAI_BASE_URL: "https://obsolete.invalid",
        OPENAI_MODEL: "obsolete-model",
      },
    });
    try {
      assert.deepEqual(await manager.listCodexModels(), [
        { slug: "from-adapter", name: "Adapter" },
      ]);
      const native = await manager.readCodexConfig();
      const custom = await manager.updateCodexConfig({
        expectedVersion: native.version,
        authMode: "custom",
        apiUrl: "https://new.example/v1",
        apiKey: "new-key",
        model: "from-adapter",
      });
      const first = await manager.resolveLaunch("codex");
      assert.equal(first.env.OPENAI_BASE_URL, "https://new.example/v1");
      assert.equal(first.env.OPENAI_API_KEY, "new-key");
      assert.equal(first.env.OPENAI_MODEL, "from-adapter");
      await manager.updateCodexConfig({
        expectedVersion: custom.version,
        authMode: "subscription",
        apiUrl: "",
        apiKey: "",
        model: "from-adapter",
      });
      const second = await manager.resolveLaunch("codex");
      assert.equal(second.env.OPENAI_API_KEY, undefined);
      assert.equal(second.env.OPENAI_BASE_URL, undefined);
      assert.equal(second.env.OPENAI_MODEL, undefined);
      assert.equal(second.env.CODEX_HOME, home);
    } finally {
      manager.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
