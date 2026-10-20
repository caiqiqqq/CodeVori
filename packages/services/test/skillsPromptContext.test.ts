import assert from "node:assert/strict";
import test from "node:test";
import type { SkillSummary } from "@zcode/shared";
import { buildSkillsPromptContext } from "../src/skills/skillsPromptContext.js";
import { createSkillsService } from "../src/skills/skillsService.js";

const skill = (
  name: string,
  scope: SkillSummary["scope"] = "workspace",
  enabled = true,
): SkillSummary => ({
  id: `${scope}:${name}`,
  name,
  scope,
  enabled,
  body: `${scope} instructions for ${name}`,
  description: "demo",
  path: `/example/${scope}/${name}/SKILL.md`,
});

test("explicit ACP skill context matches complete names, preserves saved case and ignores disabled skills", () => {
  const skills = [
    skill("Demo_Helper"),
    skill("demo"),
    skill("disabled", "workspace", false),
    skill("Skill With Spaces"),
  ];
  const input =
    "use $Demo_Helper and [$Skill With Spaces](/example/SKILL.md) plus $disabled and $demo-other";
  const result = buildSkillsPromptContext(input, skills);
  assert.deepEqual(result.activatedSkillNames, ["Demo_Helper", "Skill With Spaces"]);
  assert.ok(result.prompt.startsWith(input));
  assert.ok(result.prompt.includes("workspace instructions for Demo_Helper"));
  assert.ok(result.prompt.includes("workspace instructions for Skill With Spaces"));
  assert.ok(!result.prompt.includes("instructions for disabled"));
  assert.ok(!result.prompt.includes("instructions for demo\n"));
  const ordinary = buildSkillsPromptContext("ordinary prompt", skills);
  assert.deepEqual(ordinary.activatedSkillNames, []);
  assert.match(ordinary.prompt, /^ordinary prompt\n\n<available_plugin_skills>/);
  assert.doesNotMatch(ordinary.prompt, /<skill |<activated_skill/);
});

test("ACP skill context uses the same single-name scope precedence as the skill picker", () => {
  const result = buildSkillsPromptContext("use $demo twice $demo", [
    skill("demo", "user"),
    skill("demo", "plugin"),
    skill("demo", "workspace"),
  ]);
  assert.deepEqual(result.activatedSkillNames, ["demo"]);
  assert.ok(result.prompt.includes("workspace instructions for demo"));
  assert.ok(!result.prompt.includes("user instructions"));
  assert.ok(!result.prompt.includes("plugin instructions"));
});

const pluginSkill = (pluginId: string, name: string, enabled = true): SkillSummary => ({
  ...skill(name, "plugin", enabled),
  id: `${pluginId}:${name}`,
  pluginId,
  description: `Use ${name} for matching tasks`,
  path: `/plugins/${pluginId}/${name}/SKILL.md`,
});

test("ordinary ACP requests advertise enabled skills from every marketplace without injecting bodies", () => {
  const gitlab = pluginSkill("gitlab@official", "glab");
  const external = pluginSkill("custom@third-party", "glab");
  const result = buildSkillsPromptContext("查看这个议题", [
    gitlab,
    external,
    pluginSkill("off@third-party", "hidden", false),
    skill("workspace-only"),
    skill("user-only", "user"),
  ]);
  assert.deepEqual(result.activatedSkillNames, []);
  for (const entry of [gitlab, external]) {
    assert.ok(result.prompt.includes(`name="${entry.name}" plugin="${entry.pluginId}"`));
    assert.ok(result.prompt.includes(`path="${entry.path}"`));
    assert.ok(result.prompt.includes(entry.description));
    assert.ok(!result.prompt.includes(entry.body));
  }
  assert.doesNotMatch(result.prompt, /hidden|workspace-only|user-only|<activated_skill/);
  assert.match(result.prompt, /read.*SKILL\.md/i);
});

test("plugin catalog metadata escapes XML characters", () => {
  const entry = {
    ...pluginSkill('custom&"market', 'name<"tag'),
    path: '/plugins/"quoted"&dir/SKILL.md',
    description: "Inspect <files> & tools",
  };
  const { prompt } = buildSkillsPromptContext("ordinary prompt", [entry]);
  assert.match(prompt, /name="name&lt;&quot;tag"/);
  assert.match(prompt, /plugin="custom&amp;&quot;market"/);
  assert.match(prompt, /path="\/plugins\/&quot;quoted&quot;&amp;dir\/SKILL\.md"/);
  assert.match(prompt, /Inspect &lt;files&gt; &amp; tools/);
});

test("the Host reloads the plugin catalog for ordinary requests and publishes disabled or removed state", async (t) => {
  const service = createSkillsService({ isDesktopRuntime: true });
  let current = [pluginSkill("gitlab@official", "glab")];
  const list = t.mock.method(service, "list", async () => ({
    skills: current,
    diagnostics: [],
    capability: { userScopeAvailable: true },
  }));
  const scope = { workspacePath: "/remote/project", workspaceIdentity: "remote:project" };
  const enabled = await service.buildPromptContext({ ...scope, prompt: "查看议题" });
  assert.match(enabled.prompt, /name="glab"/);
  for (current of [[{ ...current[0], enabled: false }], []]) {
    const result = await service.buildPromptContext({ ...scope, prompt: "继续" });
    assert.match(result.prompt, /<available_plugin_skills>/);
    assert.doesNotMatch(result.prompt, /<skill |<activated_skill/);
    assert.deepEqual(result.activatedSkillNames, []);
  }
  assert.equal(list.mock.calls.length, 3);
  assert.ok(
    list.mock.calls.every(
      ({ arguments: [params] }) =>
        params.workspacePath === scope.workspacePath &&
        params.workspaceIdentity === scope.workspaceIdentity,
    ),
  );
});

test("catalog read failures reject the request instead of advertising stale skills", async (t) => {
  const service = createSkillsService({ isDesktopRuntime: true });
  t.mock.method(service, "list", async () => {
    throw new Error("catalog unavailable");
  });
  await assert.rejects(
    service.buildPromptContext({
      workspacePath: "/remote/project",
      prompt: "ordinary prompt",
    }),
    /catalog unavailable/,
  );
});
