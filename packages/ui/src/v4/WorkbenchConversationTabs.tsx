import { memo, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

interface ConversationTabProps {
  paneId: string;
  selected: boolean;
  onActivate: (paneId: string) => void;
  onContentContainerChange: (paneId: string, element: HTMLSpanElement | null) => void;
}

const ConversationTab = memo(function ConversationTab({
  paneId,
  selected,
  onActivate,
  onContentContainerChange,
}: ConversationTabProps) {
  const setContentContainer = useCallback(
    (element: HTMLSpanElement | null) => onContentContainerChange(paneId, element),
    [onContentContainerChange, paneId],
  );
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-testid={`workbench-conversation-tab-${paneId}`}
      data-workbench-tab-pane-id={paneId}
      onClick={() => onActivate(paneId)}
      className={cn(
        "flex h-8 w-40 shrink-0 items-center rounded-md px-2 text-ui-base outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
        selected
          ? "bg-selected font-medium text-foreground"
          : "text-foreground-subtle hover:bg-hover hover:text-foreground",
      )}
    >
      <span ref={setContentContainer} className="flex min-w-0 flex-1" />
    </button>
  );
});

export function WorkbenchConversationTabs({
  paneIds,
  focusedPaneId,
  onActivate,
  onContentContainerChange,
}: {
  paneIds: readonly string[];
  focusedPaneId: string;
  onActivate: (paneId: string) => void;
  onContentContainerChange: ConversationTabProps["onContentContainerChange"];
}) {
  const { intl } = useZCodeIntl();
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    const tab =
      container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[
        paneIds.indexOf(focusedPaneId)
      ];
    if (!container || !tab) return;
    const viewport = container.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    // scrollIntoView 会连带滚动 overflow-hidden 的工作区，把手机左上角按钮裁掉；只滚标签容器。
    if (bounds.left < viewport.left || bounds.width > viewport.width) {
      container.scrollLeft += bounds.left - viewport.left;
    } else if (bounds.right > viewport.right) {
      container.scrollLeft += bounds.right - viewport.right;
    }
  }, [focusedPaneId, paneIds]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const index = Math.max(0, paneIds.indexOf(focusedPaneId));
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? paneIds.length - 1
          : (index + (event.key === "ArrowLeft" ? -1 : 1) + paneIds.length) % paneIds.length;
    const paneId = paneIds[nextIndex];
    if (!paneId) return;
    event.preventDefault();
    onActivate(paneId);
    containerRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex]?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={intl.formatMessage({ id: "v4Pane.conversationTabs" })}
      onKeyDown={handleKeyDown}
      className="flex w-fit max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [app-region:no-drag]"
    >
      {paneIds.map((paneId) => (
        <ConversationTab
          key={paneId}
          paneId={paneId}
          selected={paneId === focusedPaneId}
          onActivate={onActivate}
          onContentContainerChange={onContentContainerChange}
        />
      ))}
    </div>
  );
}
