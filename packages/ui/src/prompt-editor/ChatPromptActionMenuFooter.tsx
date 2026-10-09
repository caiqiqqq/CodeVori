import { Info } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ChatPromptActionMenuFooter() {
  const { intl } = useZCodeIntl();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-ui-sm text-foreground-subtle">
      {(
        [
          ["@", "chat.composer.contextShortcut"],
          ["/", "chat.composer.capabilityShortcut"],
          ["$", "chat.composer.skillShortcut"],
        ] as const
      ).map(([trigger, id]) => (
        <div key={trigger} className="flex shrink-0 items-center gap-1.5">
          <code className="flex size-5 shrink-0 items-center justify-center rounded bg-tooltip-tag font-mono text-foreground">
            {trigger}
          </code>
          <span>{intl.formatMessage({ id })}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Info className="size-4 shrink-0" />
        <span>{intl.formatMessage({ id: "chat.composer.contextSearchHint" })}</span>
      </div>
    </div>
  );
}
