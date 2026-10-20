import { useMemo, useState } from "react";
import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { requestWorktreeSettingsConversation } from "@/lib/worktreeSettingsNavigation.js";
import { WorkspaceArchivedTasksFlatSection } from "@/WorkspaceArchivedTasksFlatSection.js";

/** 设置页只负责归档列表投影；读取与操作仍由所属 Host，查看历史由聊天壳层处理。 */
export function ConversationArchiveSection() {
  const { intl } = useZCodeIntl();
  const [sortBy, setSortBy] = useState<"created" | "updated">("updated");
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);
  const tabs = useTabStore((state) => state.tabs);
  const workspaceTabs = useMemo(() => tabs.filter(isWorkspaceTab), [tabs]);
  const workspacePath = useTabStore((state) => state.activeWorkspacePath);
  const workspaceIdentity = useTabStore((state) => state.activeWorkspaceIdentity);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <ListFilter className="size-4" />
              {intl.formatMessage({
                id:
                  sortBy === "updated"
                    ? "workspaceSidebar.sortByUpdated"
                    : "workspaceSidebar.sortByCreated",
              })}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sortBy}
              onValueChange={(value) => {
                if (value === "created" || value === "updated") setSortBy(value);
              }}
            >
              <DropdownMenuRadioItem value="updated">
                {intl.formatMessage({ id: "workspaceSidebar.sortByUpdated" })}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created">
                {intl.formatMessage({ id: "workspaceSidebar.sortByCreated" })}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div ref={setActionsContainer} className="flex items-center" />
      </div>
      <WorkspaceArchivedTasksFlatSection
        workspaceTabs={workspaceTabs}
        activeWorkspacePath={workspacePath ?? ""}
        activeWorkspaceIdentity={workspaceIdentity ?? undefined}
        activeTaskId={null}
        sortBy={sortBy}
        actionsContainer={actionsContainer}
        onSelectTask={(path, taskId, identity) =>
          requestWorktreeSettingsConversation({
            kind: "api",
            workspacePath: path,
            workspaceIdentity: identity,
            taskId,
          })
        }
        onSelectAcpSession={(session) =>
          requestWorktreeSettingsConversation({ kind: "acp", session })
        }
      />
    </div>
  );
}
