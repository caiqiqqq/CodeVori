import assert from "node:assert/strict";
import test from "node:test";
import { agentProfileSchema } from "@zcode/shared";
import { mapAgentProfilesToMentionItems } from "../src/mentions/providers/agentProfilesMentionProvider.js";
import { parseMentionMarkdown } from "../src/mentions/mentionMarkdown.js";
import { createSettingsPageConfig } from "../src/settings/settingsPageConfig.js";

test("saved agent mentions retain their stable identity through escaped names and renames", () => {
  const profile = agentProfileSchema.parse({
    id: "019b1234-5678-7123-8123-123456789abc",
    name: "审查[智能体]",
    description: "",
    instructions: "核对实现",
    execution: { kind: "acp", agent: "codex", config: [] },
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const [item] = mapAgentProfilesToMentionItems([profile]);
  assert.equal(item!.value, `agent.${profile.id}`);
  assert.deepEqual(parseMentionMarkdown(item!.markdown!), [
    { type: "subagent", label: profile.name, reference: `agent.${profile.id}` },
  ]);
  assert.equal(
    mapAgentProfilesToMentionItems([{ ...profile, name: "新名称" }])[0]!.value,
    item!.value,
  );
});
test("agent management and squads are discoverable on both desktop and web", () => {
  for (const options of [{}, { isDesktop: true }]) {
    const sections = createSettingsPageConfig(options).settingsSections;
    for (const id of ["agentProfiles", "squads"])
      assert.equal(sections.filter((section) => section.id === id).length, 1);
  }
});
