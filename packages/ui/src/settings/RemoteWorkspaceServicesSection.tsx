import { useMemo, useState } from "react";
import { MoreHorizontal, Monitor } from "lucide-react";
import { buildRemoteEnvironmentKey } from "@zcode/shared";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab, type WorkspaceTabState } from "@/store/tabStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useRemoteServiceManagement } from "@/hooks/useRemoteServiceManagement.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { formatRemoteWorkspaceTargetSubtitle } from "@/lib/remoteWorkspaceHistory.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu.js";

export function RemoteWorkspaceServicesSection({
  reconnect,
}: {
  reconnect?: (workspaceKey: string) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.remoteServices.${key}` });
  const tabs = useTabStore((state) => state.tabs);
  const sessions = useRemoteWorkspaceSessionStore((state) => state.sessionsById);
  const devices = useMemo(() => {
    const grouped = new Map<string, WorkspaceTabState>();
    for (const tab of tabs.filter(isWorkspaceTab)) {
      if (!tab.remoteTarget) continue;
      const key = buildRemoteEnvironmentKey(tab.remoteTarget);
      const previous = grouped.get(key);
      // 同设备第一个项目可能已断连，菜单必须使用仍在线的 attachment。
      if (!previous || (tab.remoteSessionId && sessions[tab.remoteSessionId]))
        grouped.set(key, tab);
    }
    return [...grouped.values()];
  }, [tabs, sessions]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const confirm = useConfirmDialog();
  const management = useRemoteServiceManagement(reconnect);
  if (!devices.length) return null;
  return (
    <section className="space-y-3" data-testid="remote-workspace-services">
      <h3 className="text-ui-base font-medium">{t("title")}</h3>
      <Input
        aria-label={t("search")}
        placeholder={t("search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {devices
          .filter((tab) =>
            `${tab.label} ${formatRemoteWorkspaceTargetSubtitle(tab.remoteTarget!)}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .map((tab) => {
            const key = tab.workspaceIdentity?.trim() || tab.workspacePath;
            // tab 的 sessionId 可能滞后于真实关闭事件；在线状态和可停止性以连接 store 为准。
            const sessionId =
              tab.remoteSessionId && sessions[tab.remoteSessionId]
                ? tab.remoteSessionId
                : undefined;
            return (
              <li key={key} className="flex min-w-0 items-center gap-3 px-3 py-2">
                <Monitor className="size-4 shrink-0 text-foreground-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui-sm">
                    {formatRemoteWorkspaceTargetSubtitle(tab.remoteTarget!)}
                  </p>
                  <p className="text-ui-xs text-foreground-subtle">
                    {t(sessionId ? "connected" : "stopped")}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("menu")}
                      disabled={Boolean(management.busy)}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {[false, true].map((restart) => (
                      <DropdownMenuItem
                        key={String(restart)}
                        disabled={
                          !management.supported || (restart ? !management.canRestart : !sessionId)
                        }
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: t(restart ? "restart" : "stop"),
                              description: t("impact"),
                              confirmVariant: "destructive",
                            }))
                          )
                            return;
                          setError("");
                          try {
                            await management.run(key, sessionId, restart);
                          } catch (cause) {
                            setError(cause instanceof Error ? cause.message : String(cause));
                          }
                        }}
                      >
                        {t(restart ? "restart" : "stop")}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
      </ul>
      {error && (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
