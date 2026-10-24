import { useState } from "react";
import { createRoot } from "react-dom/client";
import { buildAcpConversationRows, type AcpSession } from "@zcode/shared";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { ConversationTimeline } from "../src/v4/ConversationTimeline.js";
import { ZCodeIntlProvider } from "../src/i18n/IntlProvider.js";
import { TooltipProvider } from "../src/components/ui/tooltip.js";
import { PlatformProvider } from "../src/hooks/usePlatform.js";
import { ServiceProvider } from "../src/hooks/useServices.js";
import { TabStoreProvider } from "../src/store/TabStoreProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "../src/lib/codePreviewSettings.js";
import { applyTheme } from "../src/useTheme.js";
import "../src/styles.css";

interface View {
  kind: "api" | "acp";
  stage: "running" | "complete" | "recovered";
  preview: boolean;
  theme: "zai-light" | "zai-dark";
}

const explanation = "先检查容器状态，再按日志定位。";
const closing = "记好了。等你贴日志。";

function makeRows(view: View): ConversationRow[] {
  const text = `${explanation}\n\n\`\`\`bash\ncurl -k https://127.0.0.1:6443/healthz\n\`\`\``;
  const finalText = `${closing}${view.preview ? "\n\n[打开预览](http://localhost:5173/preview)" : ""}`;
  const running = view.stage === "running";
  if (view.kind === "acp") {
    const entries: AcpSession["entries"] = [
      { id: "user:fixture", kind: "user", text: "排查这个问题", createdAt: 100 },
      { id: "assistant:fixture:answer", kind: "assistant", text, createdAt: 101 },
      {
        id: "tool:fixture:write",
        kind: "tool",
        title: "Write memory",
        status: "completed",
        createdAt: 102,
      },
      {
        id: "tool:fixture:read",
        kind: "tool",
        title: "Read memory",
        status: "completed",
        createdAt: 103,
      },
      {
        id: "tool:fixture:edit",
        kind: "tool",
        title: "Edit memory",
        status: "completed",
        createdAt: 104,
      },
      { id: "assistant:fixture:closing", kind: "assistant", text: finalText, createdAt: 105 },
    ];
    return buildAcpConversationRows({
      entries,
      status: running ? "running" : "idle",
    } as AcpSession);
  }
  const base = (rowId: number) => ({
    rowId,
    turnId: "api:fixture",
    createdAt: 100 + rowId,
    createdAtSeq: rowId,
  });
  return [
    {
      ...base(1),
      kind: "turnHeader",
      origin: "userInput",
      executionKind: "agent",
      state: running ? "running" : "completedSuccess",
      startedAt: 100,
    },
    { ...base(2), kind: "userInput", origin: "realUser", text: "排查这个问题" },
    { ...base(3), kind: "assistantText", state: "complete", text },
    ...["Write", "Read", "Edit"].map((toolName, index) => ({
      ...base(index + 4),
      kind: "toolCall" as const,
      toolCallId: `memory:${index}`,
      toolName,
      status: "success" as const,
      inputText: "{}",
    })),
    {
      ...base(7),
      kind: "assistantText",
      state: running ? "streaming" : "complete",
      text: finalText,
    },
  ];
}

function Fixture() {
  const [view, setView] = useState<View>({
    kind: "acp",
    stage: "running",
    preview: false,
    theme: "zai-light",
  });
  const [generation, setGeneration] = useState(0);
  window.__replyPreservation = {
    configure(next: Partial<View>) {
      if (next.theme) applyTheme(next.theme);
      if (next.stage === "recovered") setGeneration((value) => value + 1);
      setView((previous) => ({ ...previous, ...next }));
    },
  };
  const rows = makeRows(view);
  const sessionKey = `${view.kind}:${generation}`;
  return (
    <div
      data-ready="true"
      data-kind={view.kind}
      data-stage={view.stage}
      data-theme={view.theme}
      className="h-screen bg-background text-foreground"
    >
      <ConversationTimeline
        rows={view.stage === "recovered" ? structuredClone(rows) : rows}
        totalCount={rows.length}
        sessionKey={sessionKey}
        hideTurnNavigator
        workDurationAvailable={false}
        rowContext={
          {
            workspacePath: "/fixture",
            sessionId: sessionKey,
            theme: view.theme,
            logEpoch: sessionKey,
            codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
          } as never
        }
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <PlatformProvider
    platform={{ isMacOS: false, isWindows: false, isLinux: false, isWeb: true } as never}
  >
    <TabStoreProvider>
      <ServiceProvider services={{ fileService: {} } as never}>
        <ZCodeIntlProvider initialLocale="zh-CN">
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </ZCodeIntlProvider>
      </ServiceProvider>
    </TabStoreProvider>
  </PlatformProvider>,
);
