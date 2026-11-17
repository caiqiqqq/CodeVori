import assert from "node:assert/strict";
import test from "node:test";
import { agentSquadSchema } from "@zcode/shared";
import { mapSquadsToMentionItems } from "../src/mentions/providers/squadsMentionProvider.js";
import { parseMentionMarkdown } from "../src/mentions/mentionMarkdown.js";
import { getMentionPanelGroupOrder } from "../src/mentions/mentionPanelRouting.js";
import { createSettingsPageConfig } from "../src/settings/settingsPageConfig.js";

const id = "019b1234-5678-7123-8123-123456789abc";
test("squad links preserve identity and escaped display names across rename and draft restoration", () => {
  const member = {
    id,
    name: "审查员",
    role: "审查",
    execution: { kind: "acp", agent: "codex", config: [] },
  };
  const squad = agentSquadSchema.parse({
    id,
    name: "研发[小队]",
    description: "说明",
    instructions: "",
    leader: member,
    members: [{ ...member, id: "019b1234-5678-7123-8123-123456789abd" }],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  const [item] = mapSquadsToMentionItems([squad]);
  assert.equal(item!.value, `squad.${id}`);
  assert.deepEqual(parseMentionMarkdown(item!.markdown!), [
    { type: "subagent", label: squad.name, reference: `squad.${id}` },
  ]);
  assert.equal(mapSquadsToMentionItems([{ ...squad, name: "新名称" }])[0]!.value, item!.value);
});
test("squads appear before direct agents and have a settings entry on desktop and web", () => {
  assert.deepEqual(getMentionPanelGroupOrder("@").slice(0, 2), ["squads", "delegation"]);
  assert.deepEqual(getMentionPanelGroupOrder("#"), ["sessions"]);
  for (const options of [{}, { isDesktop: true }]) {
    const entries = createSettingsPageConfig(options).settingsSections.filter(
      (section) => section.id === "squads",
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.groupId, "agentCapabilities");
  }
});
