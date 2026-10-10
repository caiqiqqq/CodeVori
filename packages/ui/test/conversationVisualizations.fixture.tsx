import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageResponse } from "../src/components/ai-elements/message.js";
import { ConversationTimeline } from "../src/v4/ConversationTimeline.js";
import { buildAcpConversationRows } from "../src/v4/acpConversationRows.js";
import { ZCodeIntlProvider } from "../src/i18n/IntlProvider.js";
import { TooltipProvider } from "../src/components/ui/tooltip.js";
import { PlatformProvider } from "../src/hooks/usePlatform.js";
import { ServiceProvider } from "../src/hooks/useServices.js";
import { TabStoreProvider } from "../src/store/TabStoreProvider.js";
import { useRemoteWorkspaceSessionStore } from "../src/store/remoteWorkspaceSessionStore.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "../src/lib/codePreviewSettings.js";
import { applyTheme } from "../src/useTheme.js";
import "../src/styles.css";

const calls: string[] = [];
const pending: Array<() => void> = [];
let missing = false;
let slow = false;
let customContent: string | null = null;
const fragment = (
  label: string,
) => `<div class="card" id="preview"><h2>${label}</h2><button id="increment" class="btn">Clicked 0</button><div id="isolation"></div></div><script>
let count=0; document.querySelector('#increment').onclick=()=>{document.querySelector('#increment').textContent='Clicked '+(++count)};
try{parent.document.body.dataset.escaped='yes'}catch{document.querySelector('#isolation').textContent='Isolated'};
fetch('https://example.com/blocked').then(()=>{document.querySelector('#isolation').textContent='network escaped'}).catch(()=>{});
</script>`;
const files = (label: string) => ({
  resolvePath: async ({ path }) => path,
  stat: async () => ({ type: "file" }),
  readFileRange: async () => {
    calls.push(label);
    if (slow && label === "Remote A") await new Promise<void>((resolve) => pending.push(resolve));
    if (missing) throw new Error("missing fixture");
    return new TextEncoder().encode(customContent ?? fragment(label));
  },
});
const local = { fileService: files("Local") };
const remoteA = { fileService: files("Remote A") };
const remoteB = { fileService: files("Remote B") };
const register = () => {
  const store = useRemoteWorkspaceSessionStore.getState();
  store.registerBaseServices(local as never);
  store.registerSession({ sessionId: "remote-a", services: remoteA as never });
  store.registerSession({ sessionId: "remote-b", services: remoteB as never });
  store.bindWorkspaceIdentity("fixture-remote-a", "remote-a");
  store.bindWorkspaceIdentity("fixture-remote-b", "remote-b");
};
register();
const marker = (mode = "wide") =>
  `\uE200visualize\uE202${JSON.stringify({ path: "/fixture/preview.html", mode })}\uE201`;
const answer = () => `**Before preview**\n\n${marker()}\n\nAfter preview`;

function Fixture() {
  const [view, setView] = useState({
    kind: "api",
    text: answer(),
    streaming: false,
    identity: "",
    remoteSessionId: "",
    session: "initial",
  });
  const [theme, setTheme] = useState("zai-light");
  const context = useMemo(
    () => ({
      workspacePath: "/fixture",
      workspaceIdentity: view.identity || undefined,
      workspaceRemoteSessionId: view.remoteSessionId || undefined,
      sessionId: view.session,
      theme,
      codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
      logEpoch: view.session,
    }),
    [view.identity, view.remoteSessionId, view.session, theme],
  );
  window.__visualizations = {
    marker: marker(),
    calls,
    content: (value: string | null) => {
      customContent = value;
    },
    configure: (next) => setView((previous) => ({ ...previous, ...next })),
    theme: (next) => {
      applyTheme(next);
      setTheme(next);
    },
    missing: (value) => {
      missing = value;
    },
    slow: (value) => {
      slow = value;
    },
    release: () => {
      slow = false;
      pending.splice(0).forEach((resolve) => resolve());
    },
    disconnect: () => useRemoteWorkspaceSessionStore.getState().unregisterSession("remote-b"),
    reconnect: register,
  };
  const rows =
    view.kind === "acp"
      ? buildAcpConversationRows({
          status: view.streaming ? "running" : "idle",
          entries: [
            { id: "user:fixture", kind: "user", text: "Preview this" },
            { id: "assistant:fixture", kind: "assistant", text: view.text },
          ],
        })
      : [
          {
            kind: "turnHeader",
            rowId: 1,
            turnId: "api",
            createdAt: 1,
            createdAtSeq: 1,
            origin: "userInput",
            executionKind: "agent",
            state: "completedSuccess",
          },
          {
            kind: "assistantText",
            rowId: 2,
            turnId: "api",
            createdAt: 2,
            createdAtSeq: 2,
            text: view.text,
            state: view.streaming ? "streaming" : "complete",
          },
        ];
  return (
    <div data-ready="true" className="h-screen bg-background text-foreground">
      {view.kind === "direct" ? (
        <div className="p-4">
          <MessageResponse renderVisualizations {...context} streaming={view.streaming}>
            {view.text}
          </MessageResponse>
        </div>
      ) : (
        <ConversationTimeline
          rows={rows as never}
          totalCount={rows.length}
          sessionKey={view.session}
          hideTurnNavigator
          workDurationAvailable={false}
          rowContext={context as never}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <PlatformProvider
    platform={{ isMacOS: false, isWindows: false, isLinux: false, isWeb: true } as never}
  >
    <TabStoreProvider>
      <ServiceProvider services={local as never}>
        <ZCodeIntlProvider initialLocale="zh-CN">
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </ZCodeIntlProvider>
      </ServiceProvider>
    </TabStoreProvider>
  </PlatformProvider>,
);
