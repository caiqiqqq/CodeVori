import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useUnifiedRemoteSync } from "@/hooks/useUnifiedRemoteSync.js";
import { RemoteSyncDialogs } from "./RemoteSyncActions.js";

const synced = () => {};
export function RemoteDataSyncSection({ isDesktop }: { isDesktop: boolean }) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.remoteSync.${key}` });
  const tabs = useTabStore((state) => state.tabs);
  const targets = tabs
    .filter(isWorkspaceTab)
    .filter((tab) => tab.remoteTarget?.kind === "ssh" || tab.remoteTarget?.kind === "wsl");
  const localTabs = tabs
    .filter(isWorkspaceTab)
    .filter((tab) => !tab.workspaceIdentity && !tab.remoteTarget && !tab.remoteSessionId);
  const [targetKey, setTargetKey] = useState("");
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const keyOf = (tab: (typeof targets)[number]) =>
    tab.workspaceIdentity?.trim() || tab.workspacePath;
  const target = targets.find((tab) => keyOf(tab) === targetKey) ?? targets[0];
  const sync = useUnifiedRemoteSync(target, isDesktop);
  const localPath = sourcePath ?? target?.localWorkspacePath ?? localTabs[0]?.workspacePath ?? "";
  const selectClass = "h-9 w-full rounded-md border border-border bg-background px-3 text-ui-sm";
  return (
    <section className="space-y-4" data-testid="settings-remote-sync">
      <p className="text-ui-sm text-foreground-subtle">{t("description")}</p>
      <label className="block space-y-2 text-ui-sm">
        <span>{t("target")}</span>
        <select
          className={selectClass}
          value={target ? keyOf(target) : ""}
          onChange={(event) => setTargetKey(event.target.value)}
        >
          {!targets.length && <option value="">{t("empty")}</option>}
          {targets.map((tab) => (
            <option key={keyOf(tab)} value={keyOf(tab)}>
              {tab.label} · {tab.workspaceIdentity || tab.workspacePath}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-2 text-ui-sm">
        <span>{t("source")}</span>
        <select
          className={selectClass}
          value={localPath}
          onChange={(event) => setSourcePath(event.target.value)}
        >
          <option value="">{t("userScope")}</option>
          {target?.localWorkspacePath &&
            !localTabs.some((tab) => tab.workspacePath === target.localWorkspacePath) && (
              <option value={target.localWorkspacePath}>{target.localWorkspacePath}</option>
            )}
          {localTabs.map((tab) => (
            <option key={tab.id} value={tab.workspacePath}>
              {tab.label} · {tab.workspacePath}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!sync.available} onClick={() => sync.skills.setOpen(true)}>
          {t("skills")}
        </Button>
        <Button disabled={!sync.available} onClick={() => sync.mcp.setOpen(true)}>
          {t("mcp")}
        </Button>
        <Button disabled={!sync.available} onClick={() => sync.plugins.setOpen(true)}>
          {t("plugins")}
        </Button>
      </div>
      {!sync.available && (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {t("connectFirst")}
        </p>
      )}
      <RemoteSyncDialogs
        key={`${target ? keyOf(target) : ""}:${target?.remoteSessionId || ""}:${localPath}`}
        {...sync.dialogs}
        canSyncSkills={sync.available}
        canSyncMcp={sync.available}
        canSyncPlugins={sync.available}
        skillOpen={sync.skills.open}
        mcpOpen={sync.mcp.open}
        pluginOpen={sync.plugins.open}
        onSkillOpenChange={sync.skills.setOpen}
        onMcpOpenChange={sync.mcp.setOpen}
        onPluginOpenChange={sync.plugins.setOpen}
        remoteTarget={target?.remoteTarget}
        workspaceIdentity={target?.workspaceIdentity}
        skillWorkspacePath={target?.workspacePath || ""}
        mcpWorkspacePath={target?.workspacePath || ""}
        pluginWorkspacePath={target?.workspacePath || ""}
        mcpLocalWorkspacePath={localPath}
        pluginLocalWorkspacePath={localPath}
        onSkillsSynced={synced}
        onMcpSynced={synced}
        onPluginsSynced={synced}
      />
    </section>
  );
}
