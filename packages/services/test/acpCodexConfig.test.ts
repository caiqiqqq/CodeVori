import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "smol-toml";
import {
  applyCodexNativeEnvironment,
  readCodexNativeConfig,
  updateCodexNativeConfig,
} from "../src/acp/acpCodexConfig.js";
import { listCodexOfficialModels } from "../src/acp/acpCodexModels.js";
import { createAcpAgentManager } from "../src/acp/acpAgentManager.js";

const externalConfig = `# managed by an external switcher
model_provider = "custom"
model = "old-model"
[model_providers.custom]
name = "External"
base_url = "https://external.example/v1"
wire_api = "responses"
requires_openai_auth = false
experimental_bearer_token = "external-fixture-key"
http_headers = { "x-openai-actor-authorization" = "fixture-actor" }
[model_providers.other]
experimental_bearer_token = "other-fixture-key"
`;

async function withNativeHome(
  config: string,
  auth: string | undefined,
  run: (home: string) => Promise<void>,
) {
  const home = await mkdtemp(join(tmpdir(), "zcode-codex-native-"));
  try {
    await writeFile(join(home, "config.toml"), config);
    if (auth !== undefined) await writeFile(join(home, "auth.json"), auth);
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("CC Switch bearer token 可读取，模型保存保留外部 provider 和 auth 文件存在性", async () => {
  for (const auth of [undefined, '{"auth_mode":"apikey"}\n']) {
    await withNativeHome(externalConfig, auth, async (home) => {
      const before = await readCodexNativeConfig(home);
      assert.equal(before.authMode, "custom");
      assert.equal(before.apiKey, "external-fixture-key");
      const after = await updateCodexNativeConfig(home, {
        expectedVersion: before.version,
        authMode: "custom",
        apiUrl: before.apiUrl,
        model: "new-model",
      });
      assert.equal(after.managedProvider, false);
      assert.equal(after.apiKey, before.apiKey);
      assert.equal(
        await readFile(join(home, "config.toml"), "utf8"),
        externalConfig.replace('model = "old-model"', 'model = "new-model"'),
      );
      if (auth === undefined)
        await assert.rejects(readFile(join(home, "auth.json")), { code: "ENOENT" });
      else assert.equal(await readFile(join(home, "auth.json"), "utf8"), auth);
    });
  }
});

test("Codex Default 模式提问开关保留 feature 表并支持普通和 dotted TOML 写法", async () => {
  const configs = [
    externalConfig.replace(
      "[model_providers.custom]",
      "[features]\nskills = true\n\n[model_providers.custom]",
    ),
    externalConfig.replace(
      "[model_providers.custom]",
      "features.skills = true\nfeatures.default_mode_request_user_input = false\n\n[model_providers.custom]",
    ),
  ];
  for (const config of configs) {
    await withNativeHome(config, undefined, async (home) => {
      const initial = await readCodexNativeConfig(home);
      assert.equal(initial.defaultModeRequestUserInput, false);
      const enabled = await updateCodexNativeConfig(home, {
        expectedVersion: initial.version,
        authMode: initial.authMode,
        apiUrl: initial.apiUrl,
        apiKey: initial.apiKey,
        model: initial.model,
        defaultModeRequestUserInput: true,
      });
      assert.equal(enabled.defaultModeRequestUserInput, true);
      let native = parse(await readFile(join(home, "config.toml"), "utf8"));
      assert.equal(
        (native.features as Record<string, unknown>).default_mode_request_user_input,
        true,
      );
      assert.equal((native.features as Record<string, unknown>).skills, true);

      const disabled = await updateCodexNativeConfig(home, {
        expectedVersion: enabled.version,
        authMode: enabled.authMode,
        apiUrl: enabled.apiUrl,
        apiKey: enabled.apiKey,
        model: enabled.model,
        defaultModeRequestUserInput: false,
      });
      assert.equal(disabled.defaultModeRequestUserInput, false);
      native = parse(await readFile(join(home, "config.toml"), "utf8"));
      assert.equal(
        Object.hasOwn(
          native.features as Record<string, unknown>,
          "default_mode_request_user_input",
        ),
        false,
      );
      assert.equal((native.features as Record<string, unknown>).skills, true);
    });
  }
});

test("Codex Default 模式提问开关缺省关闭，只创建自己的 feature 表项", async () => {
  await withNativeHome(
    externalConfig.replace('model = "old-model"', 'model = "fixture"'),
    undefined,
    async (home) => {
      const initial = await readCodexNativeConfig(home);
      assert.equal(initial.defaultModeRequestUserInput, false);
      const enabled = await updateCodexNativeConfig(home, {
        expectedVersion: initial.version,
        authMode: initial.authMode,
        apiUrl: initial.apiUrl,
        apiKey: initial.apiKey,
        model: initial.model,
        defaultModeRequestUserInput: true,
      });
      assert.equal(enabled.defaultModeRequestUserInput, true);
      assert.match(await readFile(join(home, "config.toml"), "utf8"), /\[features\]/);
      assert.equal(
        (
          parse(await readFile(join(home, "config.toml"), "utf8")).features as Record<
            string,
            unknown
          >
        ).default_mode_request_user_input,
        true,
      );
    },
  );
});

test("Codex 原生开关为显式 false 时保存关闭会移除该键", async () => {
  const config = externalConfig.replace(
    "[model_providers.custom]",
    "[features]\ndefault_mode_request_user_input = false\nskills = true\n\n[model_providers.custom]",
  );
  await withNativeHome(config, undefined, async (home) => {
    const before = await readCodexNativeConfig(home);
    assert.equal(before.defaultModeRequestUserInput, false);
    await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: before.authMode,
      apiUrl: before.apiUrl,
      model: before.model,
      defaultModeRequestUserInput: false,
    });
    const native = parse(await readFile(join(home, "config.toml"), "utf8"));
    assert.deepEqual(native.features, { skills: true });
  });
});

test("旧客户端回传相同 Key 不迁移，显式修改和清除只更新当前 provider 的 bearer token", async () => {
  const auth =
    '{"auth_mode":"chatgpt","OPENAI_API_KEY":"unrelated-key","tokens":{"access_token":"subscription-fixture"}}\n';
  await withNativeHome(externalConfig, auth, async (home) => {
    const before = await readCodexNativeConfig(home);
    const same = await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: "custom",
      apiUrl: before.apiUrl,
      apiKey: before.apiKey,
      model: before.model,
    });
    assert.equal(same.version, before.version);
    for (const key of ["updated-fixture-key", ""]) {
      const current = await readCodexNativeConfig(home);
      const after = await updateCodexNativeConfig(home, {
        expectedVersion: current.version,
        authMode: "custom",
        apiUrl: current.apiUrl,
        apiKey: key,
        model: current.model,
      });
      assert.equal(after.apiKey, key);
      const config = parse(await readFile(join(home, "config.toml"), "utf8"));
      const providers = config.model_providers as Record<string, Record<string, unknown>>;
      assert.equal(config.model_provider, "custom");
      assert.equal(providers.custom.experimental_bearer_token, key);
      assert.equal(providers.custom.requires_openai_auth, false);
      assert.equal(providers.other.experimental_bearer_token, "other-fixture-key");
      assert.equal(await readFile(join(home, "auth.json"), "utf8"), auth);
    }
  });
});

test("外部环境变量 provider 改 URL 保留认证标记、headers、env_key 与原始 auth 内容", async () => {
  const config = externalConfig.replace(
    'experimental_bearer_token = "external-fixture-key"',
    'env_key = "SWITCHER_API_KEY"',
  );
  const auth = '{ "auth_mode": "chatgpt", "tokens": {"access_token": "fixture"} }\n';
  await withNativeHome(config, auth, async (home) => {
    const before = await readCodexNativeConfig(home);
    await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: "custom",
      apiUrl: "https://changed.example/v1",
      model: before.model,
    });
    assert.equal(
      await readFile(join(home, "config.toml"), "utf8"),
      config.replace("https://external.example/v1", "https://changed.example/v1"),
    );
    assert.equal(await readFile(join(home, "auth.json"), "utf8"), auth);
    const current = await readCodexNativeConfig(home);
    await assert.rejects(
      updateCodexNativeConfig(home, {
        expectedVersion: current.version,
        authMode: "custom",
        apiUrl: current.apiUrl,
        apiKey: "must-not-migrate",
        model: current.model,
      }),
      /原生配置/,
    );
  });
});

test("auth.json Key 仅在显式编辑时更新，模型保存不重写文件", async () => {
  const config =
    'model_provider = "external"\nmodel = "old"\n[model_providers.external]\nbase_url = "https://external.example/v1"\nrequires_openai_auth = true\n';
  const auth = '{ "OPENAI_API_KEY": "auth-fixture", "tokens": {"access_token": "keep"} }\n';
  await withNativeHome(config, auth, async (home) => {
    const before = await readCodexNativeConfig(home);
    assert.equal(before.apiKey, "auth-fixture");
    const after = await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: "custom",
      apiUrl: before.apiUrl,
      model: "new",
    });
    assert.equal(await readFile(join(home, "auth.json"), "utf8"), auth);
    await updateCodexNativeConfig(home, {
      expectedVersion: after.version,
      authMode: "custom",
      apiUrl: after.apiUrl,
      apiKey: "new-auth-key",
      model: after.model,
    });
    const written = JSON.parse(await readFile(join(home, "auth.json"), "utf8"));
    assert.equal(written.OPENAI_API_KEY, "new-auth-key");
    assert.deepEqual(written.tokens, { access_token: "keep" });
    assert.equal(
      parse(await readFile(join(home, "config.toml"), "utf8")).model_provider,
      "external",
    );
  });
});

test("特殊 provider 表原样保存模型，无法安全定位编辑字段时拒绝覆盖", async () => {
  const config =
    'model_provider = "custom"\nmodel = "old"\nmodel_providers = { custom = { base_url = "https://external.example/v1", experimental_bearer_token = "fixture-key", requires_openai_auth = false } }\n';
  await withNativeHome(config, undefined, async (home) => {
    const before = await readCodexNativeConfig(home);
    const after = await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: "custom",
      apiUrl: before.apiUrl,
      model: "new",
    });
    const expected = config.replace('model = "old"', 'model = "new"');
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), expected);
    await assert.rejects(
      updateCodexNativeConfig(home, {
        expectedVersion: after.version,
        authMode: "custom",
        apiUrl: "https://changed.example/v1",
        model: after.model,
      }),
      /原文件未被覆盖/,
    );
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), expected);
    await assert.rejects(readFile(join(home, "auth.json")), { code: "ENOENT" });
  });
});

test("Codex 原生配置按当前文件补丁保存，保留未知键、注释与订阅 token", async () => {
  const home = await mkdtemp(join(tmpdir(), "zcode-codex-config-"));
  try {
    await writeFile(
      join(home, "config.toml"),
      '# original\nmodel = "old"\nmodel_provider = "other"\n[features]\nskills = true\n[model_providers.other]\nbase_url = "https://other.example/v1"\nrequires_openai_auth = true\n',
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
    assert.match(toml, /\[model_providers\.other\]\nbase_url = "https:\/\/new\.example\/v1"/);
    assert.equal(parse(toml).model_provider, "other");
    assert.doesNotMatch(toml, /\[model_providers\.zcode\]/);
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
      assert.equal(first.env.OPENAI_BASE_URL, undefined);
      assert.equal(first.env.OPENAI_API_KEY, undefined);
      assert.equal(first.env.OPENAI_MODEL, undefined);
      assert.equal((await manager.readCodexConfig()).apiKey, "new-key");
      assert.equal(
        parse(await readFile(join(home, "config.toml"), "utf8")).model_provider,
        "zcode",
      );
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

test("Codex 新连接清除旧 OPENAI 覆盖，同时保留 provider 的显式环境变量依赖", async () => {
  const cases = [
    { config: externalConfig, preserved: [] },
    { config: externalConfig.replaceAll("custom", "openai"), preserved: [] },
    {
      config:
        'model_provider = "custom"\n[model_providers.custom]\nenv_key = "OPENAI_API_KEY"\nrequires_openai_auth = false\n',
      preserved: ["OPENAI_API_KEY"],
    },
    {
      config:
        'model_provider = "custom"\n[model_providers.custom.env_http_headers]\nAuthorization = "OPENAI_API_KEY"\n"X-Endpoint" = "OPENAI_BASE_URL"\n',
      preserved: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
    },
  ];
  for (const { config, preserved } of cases) {
    await withNativeHome(config, undefined, async (home) => {
      const env: NodeJS.ProcessEnv = {
        OPENAI_API_KEY: "env-fixture",
        OPENAI_BASE_URL: "https://stale.example",
        OPENAI_MODEL: "stale-model",
        SWITCHER_KEY: "keep",
      };
      await applyCodexNativeEnvironment(home, env);
      for (const key of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"])
        assert.equal(key in env, preserved.includes(key));
      assert.equal(env.SWITCHER_KEY, "keep");
    });
  }
});

test("带引号的 provider 与 Windows 换行可原位更新，认证标记不被改写", async () => {
  const config = externalConfig
    .replaceAll('"custom"', '"custom.name"')
    .replace("[model_providers.custom]", '[ model_providers."custom.name" ] # switcher')
    .replaceAll("\n", "\r\n");
  await withNativeHome(config, undefined, async (home) => {
    const before = await readCodexNativeConfig(home);
    await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: "custom",
      apiUrl: "https://changed.example/v1",
      apiKey: "new-key",
      model: before.model,
    });
    assert.equal(
      await readFile(join(home, "config.toml"), "utf8"),
      config
        .replace("https://external.example/v1", "https://changed.example/v1")
        .replace("external-fixture-key", "new-key"),
    );
    await assert.rejects(readFile(join(home, "auth.json")), { code: "ENOENT" });
  });
});

test("新建自定义认证缺少 Key 时拒绝写出不完整配置，订阅模型保存不重写凭据", async () => {
  const config = 'model = "old"\n';
  const auth = '{ "auth_mode":"chatgpt", "tokens":{"access_token":"keep"} }\n';
  await withNativeHome(config, auth, async (home) => {
    const before = await readCodexNativeConfig(home);
    await assert.rejects(
      updateCodexNativeConfig(home, {
        expectedVersion: before.version,
        authMode: "custom",
        apiUrl: "https://new.example/v1",
        model: before.model,
      }),
      /API Key/,
    );
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), config);
    assert.equal(await readFile(join(home, "auth.json"), "utf8"), auth);
    await updateCodexNativeConfig(home, {
      expectedVersion: before.version,
      authMode: "subscription",
      apiUrl: "",
      model: "new",
    });
    assert.equal(await readFile(join(home, "auth.json"), "utf8"), auth);
  });
});

test("CC Switch 外部凭据变化后旧草稿被拒绝，刷新读取当前 provider 的新 Key", async () => {
  await withNativeHome(externalConfig, undefined, async (home) => {
    const before = await readCodexNativeConfig(home);
    const changed = externalConfig.replace("external-fixture-key", "switched-fixture-key");
    await writeFile(join(home, "config.toml"), changed);
    await assert.rejects(
      updateCodexNativeConfig(home, {
        expectedVersion: before.version,
        authMode: "custom",
        apiUrl: before.apiUrl,
        apiKey: "stale-draft",
        model: before.model,
      }),
      /已变更/,
    );
    assert.equal((await readCodexNativeConfig(home)).apiKey, "switched-fixture-key");
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), changed);
  });
});

test("多行字符串中的伪表头不得被误当成 provider 改写，错误不包含凭据", async () => {
  const config =
    'model_provider = "custom"\nmodel = "old"\nnotes = \'\'\'\n[model_providers.custom]\nexperimental_bearer_token = "private-fixture-value"\n\'\'\'\n[model_providers.custom]\nbase_url = "https://external.example/v1"\nexperimental_bearer_token = "real-fixture-value"\n';
  await withNativeHome(config, undefined, async (home) => {
    const before = await readCodexNativeConfig(home);
    await assert.rejects(
      updateCodexNativeConfig(home, {
        expectedVersion: before.version,
        authMode: "custom",
        apiUrl: before.apiUrl,
        apiKey: "replacement",
        model: before.model,
      }),
      (error: Error) => {
        assert.match(error.message, /原文件未被覆盖/);
        assert.doesNotMatch(error.message, /private-fixture-value|real-fixture-value|replacement/);
        return true;
      },
    );
    assert.equal(await readFile(join(home, "config.toml"), "utf8"), config);
  });
});

test("未配置原生凭据时保留环境认证，原生默认模型仍优先", async () => {
  for (const config of ["", 'model = "native-model"\n']) {
    await withNativeHome(config, undefined, async (home) => {
      const env = {
        OPENAI_API_KEY: "env-key-fixture",
        OPENAI_BASE_URL: "https://env.example/v1",
        OPENAI_MODEL: "env-model",
      };
      await applyCodexNativeEnvironment(home, env);
      assert.equal(env.OPENAI_API_KEY, "env-key-fixture");
      assert.equal(env.OPENAI_BASE_URL, "https://env.example/v1");
      assert.equal(env.OPENAI_MODEL, config ? undefined : "env-model");
    });
  }
});
