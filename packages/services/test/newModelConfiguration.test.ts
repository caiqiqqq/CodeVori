import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";
import {
  ModelConfigRules,
  ProviderConfigMap,
  ProviderConfigResolver,
  ProviderRegistry,
  parsePersonalProviderConfigMap,
} from "@zcode/provider";

test("Kimi K3.1 Pro and MiniMax M3.1 Flash resolve through real templates and registry selection", async () => {
  const release = decodeZCodeBuiltinRelease(
    JSON.parse(
      await readFile(
        new URL("../../../config/provider/codevori-builtin.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const cases = [
    ["moonshot-kimi", "kimi-k3.1-pro"],
    ["moonshot-kimi", "kimi-k3.1-pro-highspeed"],
    ["kimi-code-cn", "k3.1-pro"],
    ["kimi-code-cn", "k3.1-pro-highspeed"],
    ["kimi-code-intl", "k3.1-pro"],
    ["kimi-code-intl", "k3.1-pro-highspeed"],
    ["openrouter", "moonshotai/kimi-k3.1-pro"],
    ["opencode-go-chat", "kimi-k3.1-pro"],
    ["minimax", "MiniMax-M3.1-Flash"],
    ["minimax-m-plan-cn", "MiniMax-M3.1-Flash"],
    ["openrouter", "minimax/minimax-m3.1-flash"],
    ["opencode-go-chat", "minimax-m3.1-flash"],
  ];
  for (const [templateId, modelId] of cases) {
    const providerId = `test:${templateId}`;
    const personalProviders = parsePersonalProviderConfigMap({
      providerRules: [
        {
          providerId,
          templateId,
          config: {
            group: "standard-personal",
            access: { type: "api-key", apiKey: "fixture-key" },
          },
        },
      ],
    });
    const resolved = new ProviderConfigResolver().resolve({
      zcodeBuiltinProviders: release.config.providers,
      zcodeBuiltinProviderTemplates: release.config.providerTemplates,
      zcodeBuiltinModelRules: release.config.modelConfigRules,
      personalProviders,
      personalModels: new ModelConfigRules(),
      accountProviders: new ProviderConfigMap(),
    });
    const registry = new ProviderRegistry(resolved.registryProviders);
    const model = registry.getModel(providerId, modelId!);
    assert.ok(model, `${templateId}/${modelId} missing from selectable registry`);
    assert.ok(model.config.properties.contextWindow >= 1_000_000);
    assert.equal(model.config.properties.supportsToolCall, true);
    const levels = model.config.optionSpecs.reasoningLevel.values;
    assert.ok(levels.includes("max"));
    assert.deepEqual(
      registry.validateSelection({
        providerId,
        modelId: modelId!,
        options: { reasoningLevel: "max" },
      }),
      { ok: true },
    );
    assert.equal(
      registry.validateSelection({
        providerId,
        modelId: modelId!,
        options: { reasoningLevel: "unsupported" },
      }).ok,
      false,
    );
  }
});
