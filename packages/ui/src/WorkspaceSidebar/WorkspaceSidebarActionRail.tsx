import { Blocks, CalendarClock, Search } from "lucide-react";
import type { ReactNode } from "react";
import { TID_AUTOMATIONS_OPEN } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { NewTaskButtonGroup } from "@/NewTaskButtonGroup.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useShortcutCommandLabel } from "@/shortcuts/useShortcutBindings.js";

export function WorkspaceSidebarActionRail({
  onCreateTask,
  workspaceReadOnly = false,
  workspaceReadOnlyReason,
  onOpenCommandCenter,
  onOpenAutomations,
  onOpenPluginStore,
  automationsActive = false,
  pluginStoreActive = false,
  footer,
}: {
  onCreateTask: () => void;
  workspaceReadOnly?: boolean;
  workspaceReadOnlyReason?: string;
  onOpenCommandCenter?: () => void;
  onOpenAutomations?: () => void;
  onOpenPluginStore?: () => void;
  automationsActive?: boolean;
  pluginStoreActive?: boolean;
  footer?: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const searchShortcut = useShortcutCommandLabel("openCommandCenter");
  const searchLabel = intl.formatMessage({ id: "commandCenter.open" });
  const automationsLabel = intl.formatMessage({ id: "workspace.openScheduledSettings" });
  const pluginsLabel = intl.formatMessage({ id: "workspace.openPluginsSettings" });

  return (
    <div
      data-testid="workspace-sidebar-action-rail"
      className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border py-3 [app-region:no-drag]"
    >
      <NewTaskButtonGroup
        iconOnly
        onCreateTask={onCreateTask}
        disabled={workspaceReadOnly}
        disabledReason={workspaceReadOnlyReason}
      />
      <ControlHintTooltip title={searchLabel} shortcut={searchShortcut} side="right">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={searchLabel}
          data-testid="sidebar-search-open"
          onClick={onOpenCommandCenter}
        >
          <Search className="size-4" />
        </Button>
      </ControlHintTooltip>
      <ControlHintTooltip title={automationsLabel} side="right">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={automationsLabel}
          aria-pressed={automationsActive}
          className={cn(automationsActive && "bg-selected")}
          data-testid={TID_AUTOMATIONS_OPEN}
          onClick={onOpenAutomations}
        >
          <CalendarClock className="size-4" />
        </Button>
      </ControlHintTooltip>
      <ControlHintTooltip title={pluginsLabel} side="right">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={pluginsLabel}
          aria-pressed={pluginStoreActive}
          className={cn(pluginStoreActive && "bg-selected")}
          data-testid="plugin-store-sidebar-open"
          onClick={onOpenPluginStore}
        >
          <Blocks className="size-4" />
        </Button>
      </ControlHintTooltip>
      {footer}
    </div>
  );
}
