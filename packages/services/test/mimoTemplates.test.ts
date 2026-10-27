import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileModelOptionMaps } from "../../model-option-map/src/index.js";
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelConfigRules,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
  ProviderConfigResolver,
} from "@zcode/provider";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";

test("MiMo API and Token Plan resolve independently without rewriting Personal overrides", async () => {
  const release = decodeZCodeBuiltinRelease(
    JSON.parse(
      await readFile(
        new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const templates = [
    ["xiaomi-mimo", "Xiaomi MiMo API", "https://api.xiaomimimo.com/anthropic"],
    [
      "xiaomi-mimo-token-plan",
      "Xiaomi MiMo Token Plan",
      "https://token-plan-cn.xiaomimimo.com/anthropic",
    ],
  ] as const;
  const currentModels = ["mimo-v2.6-pro", "mimo-v2.6-flash"];
  for (const [templateId, name, baseUrl] of templates) {
    const template = release.config.providerTemplates.get(templateId);
    assert.ok(template, templateId);
    assert.deepEqual(template.templateNameMap, { "zh-CN": name, "en-US": name });
    assert.deepEqual(template.config.api?.toJSON(), { type: "anthropic-messages", baseUrl });
    assert.deepEqual(
      template.config.builtinModelIds,
      templateId === "xiaomi-mimo"
        ? [...currentModels, "mimo-v2.5-pro", "mimo-v2.5"]
        : currentModels,
    );
    for (const modelId of currentModels) {
      const model = release.config.modelConfigRules.resolve({
        providerId: "fixture",
        templateId,
        modelId,
        apiType: "anthropic-messages",
        baseUrl,
      });
      assert.deepEqual(model.validateComplete(), []);
      assert.equal(model.enabled, true);
      assert.equal(model.properties?.contextWindow, 1_000_000);
      assert.equal(model.properties?.inputFormat.supportsImage, true);
      assert.equal(model.optionSpecs?.maxOutputTokens?.max, 131072);
      for (const reasoningLevel of ["disabled", "enabled"]) {
        const mapped = compileModelOptionMaps({
          reasoningLevel: { map: model.optionSpecs!.reasoningLevel!.map! },
          maxOutputTokens: { map: model.optionSpecs!.maxOutputTokens!.map! },
        }).apply({}, { reasoningLevel, maxOutputTokens: 1024 });
        assert.deepEqual(JSON.parse(JSON.stringify(mapped)), {
          thinking: { type: reasoningLevel },
          max_tokens: 1024,
        });
      }
    }
  }
  const personal = new ProviderConfigMap([
    ...templates.map(([templateId]) => ({
      providerId: `new-${templateId}`,
      templateId,
      config: new ProviderConfig({
        group: "standard-personal",
        access: new ApiKeyAccessConfig({ apiKey: "fixture-key" }),
      }),
    })),
    {
      providerId: "legacy",
      templateId: "xiaomi-mimo",
      providerName: "Custom MiMo",
      enabled: false,
      config: new ProviderConfig({
        api: new ProviderApiConfig({ baseUrl: templates[1][2] }),
        access: new ApiKeyAccessConfig({ apiKey: "fixture-legacy-key" }),
      }),
    },
    {
      providerId: "custom-plan",
      templateId: "xiaomi-mimo-token-plan",
      config: new ProviderConfig({
        group: "standard-personal",
        api: new ProviderApiConfig({ baseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic" }),
        access: new ApiKeyAccessConfig({ apiKey: "fixture-custom-key" }),
      }),
    },
  ]);
  const before = personal.toJSON();
  const resolution = new ProviderConfigResolver().resolve({
    zcodeBuiltinProviders: ProviderConfigMap.empty(),
    zcodeBuiltinProviderTemplates: release.config.providerTemplates,
    accountProviders: ProviderConfigMap.empty(),
    personalProviders: personal,
    zcodeBuiltinModelRules: release.config.modelConfigRules,
    personalModels: new ModelConfigRules([
      {
        type: "provider-model",
        providerId: "custom-plan",
        modelId: currentModels[0]!,
        config: new ModelConfig({ enabled: false }),
      },
    ]),
  });
  for (const [templateId, , baseUrl] of templates) {
    assert.equal(
      resolution.registryProviders.find((p) => p.providerId === `new-${templateId}`)?.config.api
        .baseUrl,
      baseUrl,
    );
  }
  const legacy = resolution.resolvedProviders.find((p) => p.providerId === "legacy");
  assert.equal(legacy?.providerName, "Custom MiMo");
  assert.equal(legacy?.config.api?.baseUrl, templates[1][2]);
  assert.equal(
    resolution.registryProviders.some((p) => p.providerId === "legacy"),
    false,
  );
  const custom = resolution.registryProviders.find((p) => p.providerId === "custom-plan");
  assert.equal(custom?.config.api.baseUrl, "https://token-plan-sgp.xiaomimimo.com/anthropic");
  assert.deepEqual(
    custom?.models.map((model) => model.modelId),
    [currentModels[1]],
  );
  assert.deepEqual(personal.toJSON(), before);
});
