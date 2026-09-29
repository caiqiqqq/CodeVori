import assert from "node:assert/strict";
import test from "node:test";
import type { SkillSummary, ZCodePluginsAcpCapabilitiesResult } from "@zcode/shared";
import {
  availableAcpPlugins,
  buildAcpPluginPrompt,
  referencedAcpPlugins,
} from "../src/acp/acpPluginContext.js";

const skill = (pluginId: string, name: string, enabled = true): SkillSummary => ({
  id: `plugin:${pluginId}:${name}`,
  pluginId,
  name,
  enabled,
  scope: "plugin",
  path: `/plugins/${pluginId}/${name}/SKILL.md`,
  description: "Use <tools> & inspect",
  body: "private skill body",
});
const plugin = (pluginId: string, enabled = true, conflictingPluginIds: string[] = []) => ({
  pluginId,
  name: pluginId.split("@")[0]!,
  enabled,
  conflictingPluginIds,
  mcpServerNames: [],
});

test("ACP canonical plugin references share strict identity, escaping and limits with native ZCode", () => {
  assert.deepEqual(
    referencedAcpPlugins(
      "[@misleading\\]label](<plugin://demo@test>) [@repeat](plugin://demo@test) [@other](plugin://other@test)",
    ),
    ["demo@test", "other@test"],
  );
  assert.deepEqual(referencedAcpPlugins("Explain plugin://demo@test; do not activate it"), []);
  assert.deepEqual(referencedAcpPlugins("[plugin://label](https://example.test)"), []);
  for (const destination of [
    "Plugin://demo@test",
    "plugin://demo@test?token=private",
    "plugin://demo@test#fragment",
    "plugin://demo%40test",
    "plugin://demo@@test",
    "plugin://demo\\)@test",
    `plugin://${"a".repeat(253)}@test`,
  ]) {
    assert.throws(() => referencedAcpPlugins(`[@safe](${destination})`), /插件引用格式/);
  }
  const eight = Array.from({ length: 8 }, (_, index) => `[@item](plugin://p${index}@test)`).join(
    " ",
  );
  assert.equal(referencedAcpPlugins(eight).length, 8);
  assert.throws(() => referencedAcpPlugins(`${eight} [@extra](plugin://extra@test)`), /超过 8/);
});

test("ACP menu intersects installed identity, enabled skills and provisioned portable MCP without credentials", () => {
  const snapshot: ZCodePluginsAcpCapabilitiesResult = {
    plugins: [
      plugin("demo@test"),
      plugin("skills@test"),
      plugin("off@test", false),
      plugin("conflict@test", true, ["conflict@other"]),
      plugin("special@test"),
    ],
    servers: [
      {
        pluginId: "demo@test",
        name: "plugin:demo:tool",
        rootPath: "/plugins/demo",
        config: { command: "worker", env: { TOKEN: "secret-value" } },
      },
      {
        pluginId: "demo@test",
        name: "plugin:demo:missing",
        rootPath: "/plugins/demo",
        config: { command: "missing" },
      },
      {
        pluginId: "special@test",
        name: "plugin:special:oauth",
        rootPath: "/plugins/special",
        config: {
          type: "http",
          url: "https://example.test",
          oauth: { type: "authorization_code" },
        },
      },
      {
        pluginId: "special@test",
        name: "plugin:special:cua",
        rootPath: "/plugins/special",
        config: { command: "npx", args: ["@zcode/zcode-cua"] },
      },
    ],
  };
  const skills = [
    skill("demo@test", "disabled", false),
    skill("skills@test", "inspect"),
    skill("off@test", "hidden"),
    skill("conflict@test", "ambiguous"),
    skill("other@test", "unrelated"),
  ];
  const available = availableAcpPlugins(snapshot, skills, new Set(["plugin:demo:tool"]));
  assert.deepEqual(
    available.map((entry) => entry.pluginId),
    ["demo@test", "skills@test"],
  );
  assert.deepEqual(available[0]?.mcpServerNames, ["plugin:demo:tool"]);
  assert.deepEqual(available[1]?.skillNames, ["inspect"]);
  assert.doesNotMatch(
    JSON.stringify(available),
    /secret-value|TOKEN|private skill body|rootPath|config/,
  );
  const prompt = buildAcpPluginPrompt("original", ["skills@test"], available, skills);
  assert.match(prompt, /<plugin id="skills@test"/);
  assert.match(prompt, /Use &lt;tools&gt; &amp; inspect/);
  assert.doesNotMatch(prompt, /hidden|ambiguous|unrelated|private skill body|plugin:demo:tool/);
  assert.throws(
    () => buildAcpPluginPrompt("original", ["off@test"], available, skills),
    /停用、卸载/,
  );
  assert.equal(buildAcpPluginPrompt("original", [], available, skills), "original");
});
