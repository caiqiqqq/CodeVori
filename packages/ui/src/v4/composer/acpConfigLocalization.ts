import type { AcpAgent, AcpConfigOption } from "@zcode/shared";

type DisplayChoice = { value: string; name: string; description?: string };

const codex = {
  mode: {
    label: "权限模式",
    choices: {
      "read-only": "操作前确认",
      agent: "自动审核",
      "agent-full-access": "完全访问",
    },
  },
  collaboration_mode: {
    label: "协作模式",
    choices: { default: "默认", plan: "规划" },
  },
  model: { label: "模型" },
  reasoning_effort: {
    label: "推理强度",
    choices: { low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高", ultra: "极致" },
  },
  "fast-mode": { label: "快速模式" },
} satisfies Record<string, { label: string; choices?: Record<string, string> }>;

const claude = {
  mode: {
    label: "权限模式",
    choices: {
      default: "手动确认",
      acceptEdits: "自动接受编辑",
      plan: "规划",
      auto: "自动判断",
      bypassPermissions: "跳过权限确认",
    },
  },
  model: { label: "模型", choices: { default: "默认（推荐）" } },
  effort: {
    label: "推理强度",
    choices: { default: "默认", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" },
  },
  fast: { label: "快速模式" },
} satisfies Record<string, { label: string; choices?: Record<string, string> }>;

const descriptions: Record<string, string> = {
  "Approval and sandboxing preset for the session": "设置会话的授权与沙盒策略",
  "Always ask to edit external files and use the internet": "编辑外部文件或访问网络前始终询问",
  "Only ask for actions detected as potentially unsafe": "仅在操作可能不安全时询问",
  "Unrestricted access to the internet and any file on your computer":
    "允许访问网络及电脑上的所有文件",
  "How Codex collaborates for subsequent turns": "设置后续对话的协作方式",
  "Plan before making changes": "修改前先制定计划",
  "Model Codex uses for the session": "此会话使用的模型",
  "How much reasoning effort the model should use": "设置模型的推理强度",
  "Fast responses with lighter reasoning": "更快响应，减少推理",
  "Balances speed and reasoning depth for everyday tasks": "兼顾速度与推理深度，适合日常任务",
  "Greater reasoning depth for complex problems": "加深推理，适合复杂问题",
  "Extra high reasoning depth for complex problems": "进一步加深复杂问题的推理",
  "Maximum reasoning depth for the hardest problems": "以最高推理强度处理最难的问题",
  "Maximum reasoning with automatic task delegation": "最高推理强度，并自动分派任务",
  "1.5x speed, increased usage": "速度提升约 1.5 倍，使用量增加",
  "Session permission mode": "设置会话的权限模式",
  "Always ask before making changes": "修改前始终询问",
  "Automatically accept all file edits": "自动接受所有文件编辑",
  "Create a plan before making changes": "修改前先制定计划",
  "Claude handles permission decisions": "由 Claude 判断是否需要授权",
  "Accepts all permissions": "自动允许所有操作",
  "AI model to use": "此会话使用的模型",
  "Available effort levels for this model": "此模型可用的推理强度",
  "Faster responses on supported models": "在支持的模型上加快响应",
  "Frontier intelligence for the most demanding work.": "适合最复杂的任务。",
  "Workhorse model for coding and everyday work.": "适合编程与日常任务。",
  "Fast and affordable model for easier tasks.": "适合较简单的任务，响应更快。",
  "Older coding model for complex work.": "适合复杂任务的旧版编程模型。",
  "Older balanced model for straightforward work.": "适合常规任务的旧版均衡模型。",
  "Older fast and efficient model.": "旧版快速高效模型。",
  "Legacy coding model.": "旧版编程模型。",
};

// 修复 Claude 自定义模型说明混用英文的问题：仅匹配已知原文和对应 Agent，避免改写未来选项。
const claudeModelDescriptions: Record<string, string> = {
  "Custom Opus model": "自定义 Opus 模型",
  "Custom Fable model": "自定义 Fable 模型",
  "Custom Sonnet model": "自定义 Sonnet 模型",
  "Custom Haiku model": "自定义 Haiku 模型",
};

function translatedOption(
  agent: AcpAgent,
  id: string,
): { label: string; choices?: Record<string, string> } | undefined {
  const options: Record<string, { label: string; choices?: Record<string, string> }> =
    agent === "codex" ? codex : agent === "claude" ? claude : {};
  return Object.hasOwn(options, id) ? options[id] : undefined;
}

export function acpConfigOptionLabel(
  locale: string,
  agent: AcpAgent,
  option: AcpConfigOption,
): string {
  return locale === "zh-CN"
    ? (translatedOption(agent, option.id)?.label ?? option.name)
    : option.name;
}

export function acpConfigChoiceLabel(
  locale: string,
  agent: AcpAgent,
  option: AcpConfigOption,
  choice: DisplayChoice,
): string {
  if (locale !== "zh-CN") return choice.name;
  const choices = translatedOption(agent, option.id)?.choices;
  return choices && Object.hasOwn(choices, choice.value)
    ? (choices[choice.value] ?? choice.name)
    : choice.name;
}

export function acpConfigDescription(
  locale: string,
  agent: AcpAgent,
  option: AcpConfigOption,
  description?: string,
): string | undefined {
  if (!description || locale !== "zh-CN") return description;
  if (
    agent === "claude" &&
    option.id === "model" &&
    Object.hasOwn(claudeModelDescriptions, description)
  )
    return claudeModelDescriptions[description];
  return (agent === "codex" || agent === "claude") && Object.hasOwn(descriptions, description)
    ? descriptions[description]
    : description;
}

export function acpConfigGroupLabel(locale: string, name: string): string {
  return locale === "zh-CN" && name === "Other" ? "其他" : name;
}
