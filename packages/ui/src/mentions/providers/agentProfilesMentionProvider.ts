import type { AgentProfile } from "@zcode/shared";
import { buildDelegationMentionMarkdown } from "@/mentions/mentionMarkdown.js";
import type { MentionItem } from "@/mentions/mentionTypes.js";

export function mapAgentProfilesToMentionItems(profiles: AgentProfile[]): MentionItem[] {
  return profiles.map((profile) => ({
    id: `agent-profile:${profile.id}`,
    category: "subagents",
    label: profile.name,
    description: profile.description || profile.instructions,
    value: `agent.${profile.id}`,
    markdown: buildDelegationMentionMarkdown(profile.name, `agent.${profile.id}`),
    keywords: [profile.name, profile.description],
  }));
}
