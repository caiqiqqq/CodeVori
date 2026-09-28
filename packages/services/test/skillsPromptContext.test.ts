import assert from "node:assert/strict";
import test from "node:test";
import type { SkillSummary } from "@zcode/shared";
import { buildSkillsPromptContext } from "../src/skills/skillsPromptContext.js";

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
  assert.deepEqual(buildSkillsPromptContext("ordinary prompt", skills), {
    prompt: "ordinary prompt",
    activatedSkillNames: [],
  });
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
