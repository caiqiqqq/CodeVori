import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

/** 桌面未发布对话工作区时，等待用户明确选择项目，不制造手机自己的工作区。 */
export function DesktopWindowDraftLanding({
  workspaces,
  onSelectWorkspace,
}: {
  workspaces: readonly WorkspaceTabState[];
  onSelectWorkspace: (workspace: WorkspaceTabState) => void;
}) {
  const { intl } = useZCodeIntl();
  const available = workspaces.filter(
    (tab) =>
      tab.availability !== "unavailable-local-directory" &&
      (!tab.workspaceIdentity || Boolean(tab.remoteSessionId)),
  );

  return (
    <main className="flex h-full flex-col items-center justify-center overflow-y-auto bg-background p-4 text-foreground">
      <section className="w-full max-w-md space-y-4" data-testid="desktop-window-draft-landing">
        <h1 className="text-ui-xl font-medium">{intl.formatMessage({ id: "sidebar.newTask" })}</h1>
        <p className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({
            id: available.length ? "chat.empty.selectProject" : "workspaceSidebar.noProjects",
          })}
        </p>
        <div className="flex flex-col gap-2">
          {available.map((workspace) => (
            <Button
              key={workspace.id}
              variant="outline"
              className="h-auto min-h-11 justify-start py-2 text-left"
              onClick={() => onSelectWorkspace(workspace)}
            >
              <Folder className="size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate">{workspace.label}</span>
                <span className="block truncate text-ui-caption text-foreground-subtle">
                  {workspace.workspaceIdentity?.trim() || workspace.workspacePath}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </section>
    </main>
  );
}
