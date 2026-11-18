import type { AgentSquad } from "@zcode/shared";
import { buildDelegationMentionMarkdown } from "@/mentions/mentionMarkdown.js";
import type { MentionItem } from "@/mentions/mentionTypes.js";

export function mapSquadsToMentionItems(squads: AgentSquad[]): MentionItem[] {
  return squads.map((squad) => ({
    id: `squad:${squad.id}`,
    category: "subagents",
    label: squad.name,
    description: squad.description || squad.leader.name,
    value: `squad.${squad.id}`,
    markdown: buildDelegationMentionMarkdown(squad.name, `squad.${squad.id}`),
    keywords: [
      squad.name,
      squad.description,
      squad.leader.name,
      ...squad.members.map((member) => member.name),
    ],
  }));
}
