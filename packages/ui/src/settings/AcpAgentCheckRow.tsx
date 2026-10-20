import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { AcpAgentCheckId, AcpAgentCheckStatus } from "@/settings/acpAgentSettingsCatalog.js";

export function AcpCheckFact({
  label,
  value,
  technical = false,
}: {
  label: string;
  value: string;
  technical?: boolean;
}) {
  return (
    <div className="min-w-0 text-ui-sm">
      <span className="text-foreground-subtle">{label}: </span>
      <span className={`break-all text-foreground ${technical ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

const checkStatusColors: Record<AcpAgentCheckStatus, string> = {
  pass: "text-success",
  warn: "text-warning",
  fail: "text-destructive",
};

export function AcpCheckRow({
  id,
  title,
  status,
  open,
  onOpenChange,
  children,
}: {
  id: AcpAgentCheckId;
  title: string;
  status: AcpAgentCheckStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        className="min-w-0 rounded-lg border border-border bg-surface/50 px-3 py-2"
        data-testid={`settings-acp-check-${id}`}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center justify-between gap-2 text-left focus-visible:outline-2 focus-visible:outline-brand"
          >
            <span className="flex min-w-0 items-center gap-2 text-ui-base font-medium text-foreground">
              {open ? (
                <ChevronDown
                  className="size-4 shrink-0 text-foreground-subtle"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className="size-4 shrink-0 text-foreground-subtle"
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{title}</span>
            </span>
            <span className={`shrink-0 text-ui-sm font-semibold ${checkStatusColors[status]}`}>
              {intl.formatMessage({
                id: `settings.acpAgents.check${status[0]!.toUpperCase()}${status.slice(1)}`,
              })}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="space-y-2 border-t border-border pt-3">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
