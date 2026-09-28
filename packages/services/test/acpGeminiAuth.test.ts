import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";

test("Gemini 六种认证方式在重启后使用同一目标 Host 配置并隔离继承凭据", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-gemini-auth-"));
  const bin = join(root, "bin");
  const cliHome = join(root, "cli-home");
  const nativeFile = join(cliHome, ".gemini", "settings.json");
  const options = {
    directory: join(root, "agents"),
    env: {
      PATH: bin,
      HOME: root,
      GEMINI_CLI_HOME: cliHome,
      GEMINI_API_KEY: "inherited-gemini",
      GOOGLE_API_KEY: "inherited-google",
      GOOGLE_GEMINI_BASE_URL: "https://old.invalid",
      GOOGLE_CLOUD_PROJECT: "old-project",
      GOOGLE_CLOUD_LOCATION: "old-region",
      GOOGLE_APPLICATION_CREDENTIALS: "/old.json",
      GOOGLE_GENAI_USE_GCA: "true",
      GOOGLE_GENAI_USE_VERTEXAI: "true",
    },
  };
  const manager = createAcpAgentManager(options);
  try {
    await mkdir(bin);
    await writeFile(join(bin, "gemini"), "#!/bin/sh\necho 0.59.0\n", { mode: 0o755 });
    await mkdir(join(cliHome, ".gemini"), { recursive: true });
    await writeFile(
      nativeFile,
      JSON.stringify({
        security: { auth: { selectedType: "oauth-personal", other: true } },
        ui: { theme: "keep" },
      }),
    );
    const cases = [
      [
        "custom",
        "gateway",
        { GEMINI_API_KEY: "fake-gemini", GOOGLE_GEMINI_BASE_URL: "https://example.invalid" },
      ],
      ["login_google", "oauth-personal", {}],
      ["gemini_api_key", "gemini-api-key", { GEMINI_API_KEY: "fake-gemini" }],
      [
        "vertex_adc",
        "vertex-ai",
        { GOOGLE_CLOUD_PROJECT: "fake-project", GOOGLE_CLOUD_LOCATION: "global" },
      ],
      [
        "vertex_service_account",
        "vertex-ai",
        {
          GOOGLE_CLOUD_PROJECT: "fake-project",
          GOOGLE_CLOUD_LOCATION: "global",
          GOOGLE_APPLICATION_CREDENTIALS: "/fake.json",
        },
      ],
      [
        "vertex_api_key",
        "vertex-ai",
        {
          GOOGLE_API_KEY: "fake-google",
          GOOGLE_CLOUD_PROJECT: "fake-project",
          GOOGLE_CLOUD_LOCATION: "global",
        },
      ],
    ] as const;
    for (const [mode, selectedType, credentials] of cases) {
      // 测试只使用脱敏变量，明确提供全部冲突凭据以覆盖高级编辑器绕过结构化表单的场景。
      const env = {
        ...options.env,
        ZCODE_GEMINI_AUTH_MODE: mode,
        ...credentials,
        GEMINI_MODEL: "fake-model",
        EXTRA: "keep",
      };
      const { PATH: _path, HOME: _home, ...agentEnv } = env;
      await manager.updateAgent({ agent: "gemini", env: agentEnv });
      const restarted = createAcpAgentManager(options);
      try {
        const launch = await restarted.resolveLaunch("gemini");
        for (const key of [
          "GEMINI_API_KEY",
          "GOOGLE_API_KEY",
          "GOOGLE_GEMINI_BASE_URL",
          "GOOGLE_CLOUD_PROJECT",
          "GOOGLE_CLOUD_LOCATION",
          "GOOGLE_APPLICATION_CREDENTIALS",
        ]) {
          assert.equal(
            launch.env[key],
            (credentials as Record<string, string>)[key],
            `${mode}: ${key}`,
          );
        }
        assert.equal(launch.env.GEMINI_MODEL, "fake-model");
        assert.equal(launch.env.EXTRA, "keep");
        assert.equal(
          launch.env.GOOGLE_GENAI_USE_VERTEXAI,
          mode.startsWith("vertex_") ? "true" : undefined,
        );
        assert.equal(launch.env.GOOGLE_GENAI_USE_GCA, mode === "login_google" ? "true" : undefined);
        const saved = JSON.parse(await readFile(nativeFile, "utf8"));
        assert.equal(saved.security.auth.selectedType, selectedType);
        assert.equal(saved.security.auth.other, true);
        assert.deepEqual(saved.ui, { theme: "keep" });
      } finally {
        restarted.dispose();
      }
    }
    await assert.rejects(
      manager.updateAgent({ agent: "gemini", env: { ZCODE_GEMINI_AUTH_MODE: "bad-mode" } }),
    );
    await writeFile(nativeFile, "invalid json");
    await assert.rejects(manager.resolveLaunch("gemini"), /Gemini/);
    assert.equal(await readFile(nativeFile, "utf8"), "invalid json");
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Gemini 未显式选择认证的旧设置不创建原生文件且不改变原启动环境", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-gemini-legacy-"));
  const manager = createAcpAgentManager({
    directory: join(root, "agents"),
    env: { PATH: root, HOME: root },
  });
  try {
    await writeFile(join(root, "gemini"), "#!/bin/sh\necho 0.59.0\n", { mode: 0o755 });
    await manager.updateAgent({ agent: "gemini", env: { GEMINI_API_KEY: "legacy-fake" } });
    assert.equal((await manager.resolveLaunch("gemini")).env.GEMINI_API_KEY, "legacy-fake");
    await assert.rejects(readFile(join(root, ".gemini", "settings.json")), { code: "ENOENT" });
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Gemini adapter 缺失时不改写 CLI 原生认证设置", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-gemini-missing-"));
  const nativeFile = join(root, ".gemini", "settings.json");
  const manager = createAcpAgentManager({
    directory: join(root, "agents"),
    env: { PATH: "", HOME: root },
  });
  try {
    await mkdir(join(root, ".gemini"));
    const original = JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } });
    await writeFile(nativeFile, original);
    await manager.updateAgent({ agent: "gemini", env: { ZCODE_GEMINI_AUTH_MODE: "vertex_adc" } });
    await assert.rejects(manager.resolveLaunch("gemini"), /not installed/);
    assert.equal(await readFile(nativeFile, "utf8"), original);
  } finally {
    manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
