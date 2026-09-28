import type { SkillSummary, SkillsPromptContext } from "@zcode/shared";

function collectMentionedSkillNames(prompt: string): Set<string> {
  const names = new Set<string>();
  // 技能候选保存 canonical markdown；先读完整 label，避免含空格/大小写的
  // 名称被旧的小写 slug 正则截断。链接地址只展示，正文始终来自已启用的技能目录。
  const text = prompt.replace(
    /\[((?:\\.|[^\]\\])*)\]\((?:<[^>]*>|[^)]*)\)/g,
    (_link, label: string) => {
      const value = label.replace(/\\(.)/g, "$1");
      if (value.startsWith("$")) names.add(value.slice(1));
      return " ";
    },
  );
  for (const match of text.matchAll(/\$([a-zA-Z0-9._-]+)/g)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildSkillsPromptContext(
  prompt: string,
  skills: readonly SkillSummary[],
): SkillsPromptContext {
  const mentioned = collectMentionedSkillNames(prompt);
  const selected = new Map<string, SkillSummary>();
  const priority = { workspace: 0, plugin: 1, user: 2 } as const;
  for (const skill of skills) {
    if (!skill.enabled || !mentioned.has(skill.name)) continue;
    const key = skill.name.trim().toLowerCase();
    const previous = selected.get(key);
    if (!previous || priority[skill.scope] < priority[previous.scope]) selected.set(key, skill);
  }
  const activated = [...selected.values()];
  if (!activated.length) return { prompt, activatedSkillNames: [] };
  const block = [
    "<available_skills>",
    ...activated.map((skill) =>
      [
        `<activated_skill name="${escapeXmlAttribute(skill.name)}" path="${escapeXmlAttribute(skill.path)}">`,
        skill.body,
        "</activated_skill>",
      ].join("\n"),
    ),
    "</available_skills>",
  ].join("\n");
  return {
    prompt: `${prompt}\n\n${block}`,
    activatedSkillNames: activated.map((skill) => skill.name),
  };
}

export function hasExplicitSkillReference(prompt: string): boolean {
  return collectMentionedSkillNames(prompt).size > 0;
}
