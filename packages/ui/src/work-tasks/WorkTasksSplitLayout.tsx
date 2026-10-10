import { useLayoutEffect, useState, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable.js";
import { useWorkTaskMessages } from "./WorkTaskParts.js";

const PANEL_IDS = ["work-task-sidebar", "work-task-conversation"];

export function WorkTasksSplitLayout({
  sidebar,
  conversation,
  hasSelection,
}: {
  sidebar: ReactNode;
  conversation: ReactNode;
  hasSelection: boolean;
}) {
  const t = useWorkTaskMessages();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    if (!element) return;
    // 工作区可能已被全局侧栏缩窄，必须按实际容器而非窗口宽度决定分栏。
    const update = () => setWide(element.clientWidth >= 768);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return (
    <div ref={setElement} className="h-full min-h-0 min-w-0">
      <ResizablePanelGroup
        id="work-task-workbench"
        layoutId="work-tasks-workbench-horizontal-v1"
        panelIds={PANEL_IDS}
        persistenceEnabled={wide}
        disabled={!wide}
        data-wide={wide}
        // 窄屏隐藏另一栏后，库留下的 flex-grow < 1 会保留空白；只覆盖投影，不改桌面比例。
        className="group/work-task-workbench min-h-0 min-w-0 [&>[hidden]]:hidden! data-[wide=false]:[&>[data-panel]]:flex-1!"
      >
        <ResizablePanel
          id={PANEL_IDS[0]}
          // 原默认宽度让项目/状态挤压任务标题；增加阅读空间，仍由原布局 owner 恢复手动宽度。
          defaultSize="360px"
          groupResizeBehavior="preserve-pixel-size"
          minSize={wide ? "260px" : "0px"}
          maxSize={wide ? "560px" : "100%"}
          // Panel 的 class/style 作用于内层；hidden 配合父级选择器才能移除外层占位。
          hidden={!wide && hasSelection}
        >
          {sidebar}
        </ResizablePanel>
        <ResizableHandle
          aria-label={t("resizeSidebar")}
          title={t("resizeSidebar")}
          className="aria-[orientation=vertical]:my-0 aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-1 aria-[orientation=vertical]:translate-x-0 aria-[orientation=vertical]:[mask-image:none] aria-[orientation=vertical]:[-webkit-mask-image:none] before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border"
          style={!wide ? { display: "none" } : undefined}
        />
        <ResizablePanel
          id={PANEL_IDS[1]}
          minSize={wide ? "380px" : "0px"}
          hidden={!wide && !hasSelection}
        >
          {conversation}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
