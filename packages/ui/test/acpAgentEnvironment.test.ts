import assert from "node:assert/strict";
import test from "node:test";
import { ACP_AGENT_CATALOG } from "@zcode/shared";
import {
  ACP_AGENT_ENV_FIELDS,
  acpEnvValue,
  patchAcpEnvText,
  patchAcpAgentFieldText,
  inferAcpGeminiAuthMode,
  clearAcpEnvDraftIfUnchanged,
  acpQoderLoginCommand,
  normalizeAcpAgentEnvText,
} from "../src/settings/acpAgentEnvironment.ts";
import { formatAcpEnv, parseAcpEnv } from "../src/settings/useAcpAgentManagement.ts";
import zhCN from "../src/i18n/locales/zh-CN.ts";
import enUS from "../src/i18n/locales/en-US.ts";

test("agent environment fields follow real Codeg keys without invented generic credentials", () => {
  assert.deepEqual(
    Object.keys(ACP_AGENT_ENV_FIELDS).sort(),
    ACP_AGENT_CATALOG.map(({ id }) => id).sort(),
  );
  assert.deepEqual(
    ACP_AGENT_ENV_FIELDS.claude.map(({ key }) => key),
    ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"],
  );
  assert.deepEqual(
    ACP_AGENT_ENV_FIELDS.qoder.map(({ key }) => key),
    ["QODER_PERSONAL_ACCESS_TOKEN"],
  );
  assert.deepEqual(
    ACP_AGENT_ENV_FIELDS.deepseek.map(({ key }) => key),
    ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_ACP_MODEL"],
  );
  assert.deepEqual(ACP_AGENT_ENV_FIELDS.codex, []);
  assert.ok(
    Object.values(ACP_AGENT_ENV_FIELDS)
      .flat()
      .every(({ key }) => !["QODER_API_KEY", "QODER_BASE_URL", "OPENAI_API_KEY"].includes(key)),
  );
});

test("Gemini authentication shares the raw draft without dropping unrelated edits", () => {
  const original =
    "# keep\nEXTRA=yes\nGEMINI_API_KEY=fake-old\nGOOGLE_GEMINI_BASE_URL=https://example.invalid\nINCOMPLETE";
  const oauth = normalizeAcpAgentEnvText(
    "gemini",
    patchAcpEnvText(original, "ZCODE_GEMINI_AUTH_MODE", "login_google"),
  );
  assert.equal(oauth, "# keep\nEXTRA=yes\nINCOMPLETE\nZCODE_GEMINI_AUTH_MODE=login_google");
  const vertex = normalizeAcpAgentEnvText(
    "gemini",
    patchAcpEnvText(original, "ZCODE_GEMINI_AUTH_MODE", "vertex_service_account"),
  );
  assert.ok(!vertex.includes("GEMINI_API_KEY="));
  assert.ok(!vertex.includes("GOOGLE_GEMINI_BASE_URL="));
  assert.equal(normalizeAcpAgentEnvText("gemini", original), original);
  assert.equal(
    acpEnvValue(
      patchAcpAgentFieldText("gemini", "", "GEMINI_API_KEY", "fake-key"),
      "ZCODE_GEMINI_AUTH_MODE",
    ),
    "gemini_api_key",
  );
  const custom = patchAcpAgentFieldText(
    "gemini",
    "",
    "GOOGLE_GEMINI_BASE_URL",
    "https://example.invalid",
  );
  assert.equal(acpEnvValue(custom, "ZCODE_GEMINI_AUTH_MODE"), "custom");
  assert.equal(
    acpEnvValue(
      patchAcpAgentFieldText("gemini", custom, "GEMINI_API_KEY", "fake-key"),
      "GEMINI_API_KEY",
    ),
    "fake-key",
  );
});

test("Antigravity's explicit auth method clears only conflicting credentials", () => {
  const original =
    "# own comment\nOTHER=keep\nAGY_AUTH_METHOD=agent-platform\nGEMINI_API_KEY=old\nGOOGLE_API_KEY=agent-key\nGOOGLE_CLOUD_PROJECT=old-project\nGOOGLE_CLOUD_LOCATION=old-region";
  assert.equal(
    normalizeAcpAgentEnvText("antigravity", original),
    "# own comment\nOTHER=keep\nAGY_AUTH_METHOD=agent-platform\nGOOGLE_API_KEY=agent-key",
  );
  const withoutKey = patchAcpEnvText(original, "GOOGLE_API_KEY", "");
  assert.equal(
    normalizeAcpAgentEnvText("antigravity", withoutKey),
    "# own comment\nOTHER=keep\nAGY_AUTH_METHOD=agent-platform\nGOOGLE_CLOUD_PROJECT=old-project\nGOOGLE_CLOUD_LOCATION=old-region",
  );
  const oauth = patchAcpEnvText(original, "AGY_AUTH_METHOD", "oauth-personal");
  assert.equal(
    normalizeAcpAgentEnvText("antigravity", oauth),
    "# own comment\nOTHER=keep\nAGY_AUTH_METHOD=oauth-personal",
  );
  assert.equal(
    normalizeAcpAgentEnvText("antigravity", patchAcpEnvText(original, "AGY_AUTH_METHOD", "")),
    patchAcpEnvText(original, "AGY_AUTH_METHOD", ""),
  );
  assert.equal(normalizeAcpAgentEnvText("qoder", original), original);
});

test("Gemini 按 Codeg 显示七项认证，并按旧凭据推断，无凭据默认 Google 登录", () => {
  assert.deepEqual(ACP_AGENT_ENV_FIELDS.gemini[0].options, [
    "custom",
    "login_google",
    "gemini_api_key",
    "vertex_adc",
    "vertex_service_account",
    "vertex_api_key",
    "model_provider",
  ]);
  for (const [text, expected] of [
    ["", "login_google"],
    ["GOOGLE_GEMINI_BASE_URL=https://gemini.invalid\nGEMINI_API_KEY=fake", "custom"],
    ["GEMINI_API_KEY=fake", "gemini_api_key"],
    ["GOOGLE_API_KEY=fake", "vertex_api_key"],
    ["GOOGLE_APPLICATION_CREDENTIALS=/fake.json", "vertex_service_account"],
    ["GOOGLE_CLOUD_PROJECT=fake", "vertex_adc"],
    ["ZCODE_GEMINI_AUTH_MODE=model_provider", "model_provider"],
  ])
    assert.equal(inferAcpGeminiAuthMode(text!), expected);
  const bound = normalizeAcpAgentEnvText(
    "gemini",
    "ZCODE_GEMINI_AUTH_MODE=model_provider\nZCODE_GEMINI_PROVIDER_ID=fake-id\nGEMINI_API_KEY=stale\nGEMINI_MODEL=stale\nEXTRA=keep\nINCOMPLETE",
  );
  assert.equal(acpEnvValue(bound, "ZCODE_GEMINI_PROVIDER_ID"), "fake-id");
  assert.equal(acpEnvValue(bound, "GEMINI_API_KEY"), "");
  assert.equal(acpEnvValue(bound, "GEMINI_MODEL"), "");
  assert.ok(bound.includes("INCOMPLETE"));
  const unbound = normalizeAcpAgentEnvText(
    "gemini",
    patchAcpEnvText(bound, "ZCODE_GEMINI_AUTH_MODE", "login_google"),
  );
  assert.equal(acpEnvValue(unbound, "ZCODE_GEMINI_PROVIDER_ID"), "");
  assert.equal(acpEnvValue(unbound, "EXTRA"), "keep");
});

test("agent-specific field and auth method labels exist in both locales", () => {
  const keys = [
    ...Object.keys(ACP_AGENT_ENV_FIELDS).map((agent) => `hint.${agent}`),
    ...new Set(
      Object.values(ACP_AGENT_ENV_FIELDS)
        .flat()
        .map(({ label }) => label),
    ),
    ...ACP_AGENT_ENV_FIELDS.antigravity[0].options.map((method) => `method.${method}`),
    ...ACP_AGENT_ENV_FIELDS.gemini[0].options.map((method) => `method.${method}`),
    "saveGemini",
    "geminiAuthDocs",
    ...ACP_AGENT_ENV_FIELDS.gemini[0].options.map((mode) => `geminiHint.${mode}`),
    "geminiTitle",
    ...[
      "select",
      "empty",
      "missing",
      "loading",
      "loadFailed",
      "saveFailed",
      "add",
      "edit",
      "delete",
      "deleteConfirm",
      "refresh",
      "configure",
      "hint",
      "name",
      "apiUrl",
      "apiKey",
      "model",
      "invalid",
      "cancel",
      "save",
    ].map((key) => `provider.${key}`),
    "title",
    "default",
    "optional",
    "show",
    "hide",
    "advanced",
    "common",
    "advancedHint",
    "clearHint",
    "qoderLogin",
  ];
  for (const key of keys) {
    const id = `settings.acpAgents.env.${key}`;
    assert.ok(zhCN[id], `Chinese ${id}`);
    assert.ok(enUS[id], `English ${id}`);
  }
});

test("raw editor projects every saved key, including keys outside the common fields", () => {
  const saved = {
    ANTHROPIC_AUTH_TOKEN: "fake-token",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "fake-model",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  const text = formatAcpEnv(saved);
  assert.deepEqual(parseAcpEnv(text), saved);
  assert.equal(acpEnvValue(text, "ANTHROPIC_AUTH_TOKEN"), "fake-token");
  assert.equal(Object.keys(parseAcpEnv(formatAcpEnv({}))).length, 0);
});

test("structured edits share the advanced draft and preserve unfinished lines", () => {
  const unfinished =
    "# original note\nEXTRA=keep=value\nQODER_PERSONAL_ACCESS_TOKEN=old\nINCOMPLETE";
  const updated = patchAcpEnvText(unfinished, "QODER_PERSONAL_ACCESS_TOKEN", "new");
  assert.equal(
    updated,
    "# original note\nEXTRA=keep=value\nQODER_PERSONAL_ACCESS_TOKEN=new\nINCOMPLETE",
  );
  assert.equal(acpEnvValue(updated, "QODER_PERSONAL_ACCESS_TOKEN"), "new");
  assert.equal(
    patchAcpEnvText(updated, "QODER_PERSONAL_ACCESS_TOKEN", ""),
    "# original note\nEXTRA=keep=value\nINCOMPLETE",
  );
  assert.equal(acpEnvValue("FOO=one\nFOO=two", "FOO"), "two");
});

test("a completed save cannot erase edits typed while it was in flight", () => {
  const submitted = "QODER_PERSONAL_ACCESS_TOKEN=old";
  assert.equal(clearAcpEnvDraftIfUnchanged(submitted, submitted), undefined);
  assert.equal(
    clearAcpEnvDraftIfUnchanged("QODER_PERSONAL_ACCESS_TOKEN=new", submitted),
    "QODER_PERSONAL_ACCESS_TOKEN=new",
  );
});

test("advanced env parsing accepts comments without echoing malformed credentials", () => {
  assert.deepEqual(parseAcpEnv("# note\nCUSTOM=keep=value\n__proto__=own-value"), {
    CUSTOM: "keep=value",
    ["__proto__"]: "own-value",
  });
  assert.throws(() => parseAcpEnv("invalid credential input"), /^Error: 第 1 行/);
  assert.throws(() => parseAcpEnv("HOME=blocked"), /名称无效/);
  assert.throws(() => parseAcpEnv("CUSTOM=one\nCUSTOM=two"), /第 2 行/);
});

test("Qoder login instructions use the resolved target Host entry, including managed npm", () => {
  assert.equal(
    acpQoderLoginCommand({
      source: "system",
      distribution: "npm",
      executablePath: "/path with space/qoder",
    }),
    "'/path with space/qoder' login",
  );
  assert.equal(
    acpQoderLoginCommand({
      source: "managed",
      distribution: "npm",
      executablePath: "/managed/cli.js",
    }),
    "node '/managed/cli.js' login",
  );
  assert.equal(
    acpQoderLoginCommand({
      source: "managed",
      distribution: "npm",
      executablePath: "C:\\path with space\\cli.js",
    }),
    'node "C:\\path with space\\cli.js" login',
  );
});
