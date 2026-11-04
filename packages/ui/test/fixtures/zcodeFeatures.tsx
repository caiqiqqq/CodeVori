import React, { useEffect, useState } from "react";
import { AssistantPreviewCards } from "../../src/AssistantPreviewCards.js";
import { McpServerForm } from "../../src/settings/McpServerForm.js";
import { formToConfig } from "../../src/settings/mcpSettingsShared.js";
import { PluginsSection } from "../../src/settings/PluginsSection.js";
import { ProjectsSection } from "../../src/settings/ProjectsSection.js";
import { RemoteDataSyncSection } from "../../src/settings/RemoteDataSyncSection.js";
import { RemoteWorkspaceServicesSection } from "../../src/settings/RemoteWorkspaceServicesSection.js";
import { ConfirmDialogHost } from "../../src/ConfirmDialog.js";
import { ServiceProvider } from "../../src/hooks/useServices.js";
import { PlatformProvider } from "../../src/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "../../src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../src/components/ui/tooltip.js";
import { TabStoreProvider, useTabStoreApi } from "../../src/store/TabStoreProvider.js";
import { useRemoteWorkspaceSessionStore } from "../../src/store/remoteWorkspaceSessionStore.js";
import { useFileContextActions } from "../../src/hooks/useFileContextActions.js";
import { useGlobalTaskList } from "../../src/hooks/useGlobalTaskList.js";
import { useZCodeSessionStore } from "../../src/store/zcodeSessionStore.js";
import "../../src/styles.css";
import { createRemoteSyncFixture } from "./remoteSyncServices.js";

const events: unknown[] = [];
const failures = { settings: "", stop: "" };
const settings = { recentProjects: ["/project-a", "/project-b"], workspaceAliases: {} };
const tasks = [
  { taskId: "read", workspacePath: "/project-a", unreadAt: undefined },
  {
    taskId: "unread",
    workspacePath: "/same",
    workspaceIdentity: "ssh:fixture:/same",
    unreadAt: 123,
  },
];
const status = { one: "update-available", two: "update-available", three: "update-available" };
const pluginInfo = (name: string) => ({
  id: `${name}@fixture`,
  name,
  marketplace: "fixture",
  source: "cache",
  scope: "user",
  enabled: true,
  version: "1.0.0",
  rootPath: `/plugins/${name}`,
  components: [],
  skillRootCount: 0,
  commandRootCount: 0,
  mcpServerNames: [],
});
const pluginService = {
  listPlugins: async () => ({ plugins: Object.keys(status).map(pluginInfo), diagnostics: [] }),
  getPluginsOverview: async () => ({
    marketplaces: [{ id: "fixture", name: "fixture", source: "/fixture" }],
    installedPlugins: Object.entries(status).map(([name, updateStatus]) => ({
      ...pluginInfo(name),
      updateStatus,
    })),
    availablePlugins: [],
    restorableBuiltins: [],
    diagnostics: [],
  }),
  updatePlugin: async ({ pluginId }: { pluginId: string }) => {
    events.push(["plugin-update", pluginId]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (pluginId === "two@fixture") throw Error("fixture update failure");
    status[pluginId.split("@")[0] as keyof typeof status] = "none";
    return { diagnostics: [] };
  },
};
const syncFixture = createRemoteSyncFixture(events);
const services = {
  windowControllerService: {
    onDynamicControllerFrame: () => () => ({ dispose() {} }),
    subscribeControllerV4: async () => ({ ack: { subscriptionId: crypto.randomUUID() } }),
    unsubscribeControllerV4: async () => {},
    listTaskList: async (query: { kind: string; workspaceScopes: unknown[] }) => {
      events.push(["task-query", query]);
      const items = tasks.filter((task) => query.kind !== "unread" || task.unreadAt !== undefined);
      return { items, total: items.length, hasMore: false };
    },
  },
  settingService: {
    get: async () => ({ ...settings, recentProjects: [...settings.recentProjects] }),
    update: async (patch: object) => {
      if (failures.settings) throw new Error(failures.settings);
      Object.assign(settings, patch);
      events.push(["settings", patch]);
    },
  },
  broadcastService: { onMessage: () => ({ dispose() {} }), send: async () => {} },
  fileService: {
    checkFilesExist: async ({ paths }: { paths: string[] }) =>
      paths.map((path) => ({ path, exists: true })),
  },
  pluginManagementService: pluginService,
  ...syncFixture.services,
  zcodeAgentService: {
    listSessions: async () => [],
    listMcpServers: async () => ({ servers: [], diagnostics: [] }),
  },
  zcodeTaskService: {
    listTasks: async () => [],
    listPinnedTasks: async () => [],
    listArchivedTasks: async () => [],
    deleteArchivedTasks: async (scope: unknown) => {
      events.push(["purge", scope]);
      return { deletedTaskIds: [], failedTaskIds: [], skippedTaskIds: [] };
    },
  },
};
const platform = {
  canSelectFilePath: true,
  clientMode: "desktop-continuous",
  os: "darwin",
  getInstalledEditors: async () => [],
  openInFileManager: async (path: string) => {
    events.push(["reveal", path]);
    return { success: true };
  },
  openInEditor: async (...args: unknown[]) => {
    events.push(["editor", ...args]);
    throw Error("fixture WSL error");
  },
  openExternal: (url: string) => events.push(["external", url]),
  stopRemoteService: async (id: string) => {
    events.push(["stop", id]);
    if (failures.stop) throw new Error(failures.stop);
    await new Promise((resolve) => setTimeout(resolve, 100));
    useRemoteWorkspaceSessionStore.getState().unregisterSession(id);
  },
};
const target = { kind: "ssh", host: "fixture.invalid", port: 22, username: "fixture" };

function UnreadFixture() {
  const tabs = useTabStoreApi();
  const [unread, setUnread] = useState(false);
  const result = useGlobalTaskList({
    kind: unread ? "unread" : "timeline",
    workspaceTabs: tabs.getState().tabs.filter((tab) => tab.kind === "workspace"),
    sortBy: "updated",
    searchQuery: "",
    expanded: false,
    collapsedLimit: 20,
  });
  return (
    <>
      <button aria-pressed={unread} onClick={() => setUnread(!unread)}>
        未读筛选
      </button>
      {result.items.map((task) => (
        <button
          key={task.taskId}
          data-task={task.taskId}
          onClick={() => {
            const found = tasks.find((item) => item.taskId === task.taskId);
            if (found) found.unreadAt = undefined;
            useZCodeSessionStore
              .getState()
              .bumpTaskListVersion(task.workspacePath, task.workspaceIdentity);
          }}
        >
          {task.taskId}
        </button>
      ))}
    </>
  );
}

function Content() {
  const tabs = useTabStoreApi();
  const mode = new URLSearchParams(location.search).get("mode") ?? "cards";
  const [ready, setReady] = useState(false);
  const [editorMode, setEditorMode] = useState<"json" | "form">("form");
  const [saved, setSaved] = useState<any>();
  const [formKey, setFormKey] = useState(0);
  const [scope, setScope] = useState("user");
  const wsl = useFileContextActions({
    canOpenLocalFileManager: true,
    isRemoteWorkspace: true,
    workspaceIdentity: "fixture-wsl",
    remoteTarget: { kind: "wsl", distro: "Ubuntu" } as never,
  });
  useEffect(() => {
    const local = { id: "local", kind: "workspace", label: "local", workspacePath: "/project-a" };
    const remote = {
      id: "remote",
      kind: "workspace",
      label: "remote",
      workspacePath: "/same",
      workspaceIdentity: "ssh:fixture:/same",
      remoteTarget: target,
      remoteSessionId: "remote-live",
    };
    const store = useRemoteWorkspaceSessionStore.getState();
    store.registerBaseServices(services as never);
    store.registerSession({
      sessionId: "remote-live",
      services: services as never,
      target: target as never,
    });
    store.bindWorkspaceIdentity(remote.workspaceIdentity, "remote-live");
    tabs.setState({
      tabs: [local, remote],
      activeWorkspacePath: "/project-a",
      activeTabId: "local",
    } as never);
    (window as any).__feature = {
      events,
      settings,
      tabs,
      store: useRemoteWorkspaceSessionStore,
      sync: syncFixture.control,
      failures,
    };
    setReady(true);
  }, [tabs]);
  if (!ready) return null;
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-5">
      {mode === "cards" && (
        <>
          <AssistantPreviewCards
            workspacePath="/project-a"
            cards={[
              {
                id: "web",
                type: "website",
                title: "Fixture website",
                subtitleId: "chat.previewCards.website",
                url: "http://localhost:4321/preview",
              },
              {
                id: "file",
                type: "markdown",
                kind: "markdown",
                title: "Fixture document",
                subtitleId: "chat.previewCards.markdown",
                path: "/project-a/report.md",
              },
            ]}
            onOpenBrowserUrl={(url) => events.push(["preview-web", url])}
            onOpenFileLink={(file) => events.push(["preview-file", file])}
          />
          <button
            onClick={() =>
              void wsl.revealInFileManager({ path: "/home/fixture/report.md", kind: "file" })
            }
          >
            WSL reveal rejection
          </button>
        </>
      )}
      {mode === "plugins" && (
        <PluginsSection
          isDesktop
          isMacDesktop
          workspacePath="/project-a"
          onOpenPluginStore={() => {}}
        />
      )}
      {mode === "projects" && <ProjectsSection />}
      {mode === "unread" && <UnreadFixture />}
      {mode === "remote" && (
        <>
          <RemoteWorkspaceServicesSection
            reconnect={async (key) => {
              events.push(["reconnect", key]);
            }}
          />
          <RemoteDataSyncSection isDesktop />
        </>
      )}
      {mode === "mcp" && (
        <>
          <button onClick={() => setEditorMode(editorMode === "form" ? "json" : "form")}>
            Toggle JSON
          </button>
          <button
            onClick={() => {
              setSaved(undefined);
              setFormKey((key) => key + 1);
            }}
          >
            New MCP
          </button>
          <McpServerForm
            key={formKey}
            initial={saved}
            editingId={saved?.id}
            editorMode={editorMode}
            onEditorModeChange={setEditorMode}
            scopeKey={scope}
            workspaceTabs={tabs.getState().tabs.filter((tab) => tab.kind === "workspace") as never}
            onScopeKeyChange={setScope}
            onSave={(form) => {
              const config = formToConfig(form);
              const server = {
                id: `user:${form.name}`,
                name: form.name,
                scope: form.storageLevel,
                config,
              };
              events.push(["mcp-save", server]);
              setSaved(server);
              setFormKey((key) => key + 1);
            }}
            onCancel={() => {
              events.push(["mcp-cancel"]);
              setFormKey((key) => key + 1);
            }}
            onDelete={(server) => {
              events.push(["mcp-delete", server.name]);
              setSaved(undefined);
              setFormKey((key) => key + 1);
            }}
          />
        </>
      )}
      <ConfirmDialogHost />
    </main>
  );
}

export function ZCodeFeatureFixture() {
  return (
    <ZCodeIntlProvider initialLocale="zh-CN">
      <TooltipProvider>
        <TabStoreProvider>
          <ServiceProvider services={services as never}>
            <PlatformProvider platform={platform as never}>
              <Content />
            </PlatformProvider>
          </ServiceProvider>
        </TabStoreProvider>
      </TooltipProvider>
    </ZCodeIntlProvider>
  );
}
