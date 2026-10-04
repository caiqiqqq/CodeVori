import type { AcpAgent } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import claude from "@/assets/acp-agent-icons/claude.svg";
import codex from "@/assets/acp-agent-icons/codex.svg";
import gemini from "@/assets/acp-agent-icons/gemini.svg";
import openclaw from "@/assets/acp-agent-icons/openclaw.svg";
import opencode from "@/assets/acp-agent-icons/opencode.svg";
import cline from "@/assets/acp-agent-icons/cline.svg";
import hermes from "@/assets/acp-agent-icons/hermes.svg";
import codebuddy from "@/assets/acp-agent-icons/codebuddy.svg";
import kimiCode from "@/assets/acp-agent-icons/kimi-code.svg";
import pi from "@/assets/acp-agent-icons/pi.svg";
import grok from "@/assets/acp-agent-icons/grok.svg";
import cursor from "@/assets/acp-agent-icons/cursor.svg";
import deepseek from "@/assets/acp-agent-icons/deepseek.svg";
import qoder from "@/assets/acp-agent-icons/qoder.svg";
import antigravity from "@/assets/acp-agent-icons/antigravity.svg";

const AGENT_ICONS = {
  claude: { src: claude, monochrome: false },
  codex: { src: codex, monochrome: false },
  gemini: { src: gemini, monochrome: false },
  openclaw: { src: openclaw, monochrome: false },
  opencode: { src: opencode, monochrome: true },
  cline: { src: cline, monochrome: true },
  hermes: { src: hermes, monochrome: true },
  codebuddy: { src: codebuddy, monochrome: true },
  "kimi-code": { src: kimiCode, monochrome: false },
  pi: { src: pi, monochrome: false },
  grok: { src: grok, monochrome: true },
  cursor: { src: cursor, monochrome: true },
  deepseek: { src: deepseek, monochrome: false },
  qoder: { src: qoder, monochrome: true },
  antigravity: { src: antigravity, monochrome: true },
} satisfies Record<AcpAgent, { src: string; monochrome: boolean }>;

/** 列表与详情共用品牌映射；单色 SVG 用 mask 跟随前景色，避免暗色主题下变成黑块。 */
export function AcpAgentIcon({ agent, className }: { agent: AcpAgent; className?: string }) {
  const icon = AGENT_ICONS[agent];
  return (
    <span
      aria-hidden="true"
      data-acp-agent-icon={agent}
      className={cn("inline-flex size-4 shrink-0 text-foreground", className)}
    >
      {icon.monochrome ? (
        <span
          data-acp-icon-mask
          className="size-full bg-current"
          style={{
            maskImage: `url("${icon.src}")`,
            maskSize: "contain",
            maskPosition: "center",
            maskRepeat: "no-repeat",
          }}
        />
      ) : (
        <img src={icon.src} alt="" className="size-full object-contain" />
      )}
    </span>
  );
}
