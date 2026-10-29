import { lazy, Suspense, useState, type ReactNode } from "react";
import type { WorkTaskScope } from "@zcode/shared";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { getPathLeaf } from "@/lib/path.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const PreviewPane = lazy(() =>
  import("@/PreviewPane.js").then((module) => ({ default: module.PreviewPane })),
);
type PreviewActions = {
  onOpenCodeViewer(source: CodeViewerSource): void;
  onOpenFileLink(target: MessageFileLinkTarget): void;
};
export function AgentBoardPreview({
  scope,
  onOpenBrowserUrl,
  children,
}: {
  scope: WorkTaskScope;
  onOpenBrowserUrl?: (url: string) => void;
  children(actions: PreviewActions): ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const [source, setSource] = useState<CodeViewerSource | null>(null);
  const close = () => setSource(null);
  const open = (next: CodeViewerSource) => {
    // 看板隐藏 Shell 侧栏，文件预览需在详情内可见；已有 source 身份不能被当前 Shell 覆盖。
    setSource(
      next.workspacePath
        ? next
        : {
            ...next,
            workspacePath: scope.workspacePath,
            workspaceIdentity: next.workspaceIdentity ?? scope.workspaceIdentity,
            workspaceRemoteSessionId: next.workspaceRemoteSessionId ?? scope.remoteSessionId,
          },
    );
  };
  return (
    <>
      {children({
        onOpenCodeViewer: open,
        onOpenFileLink: (target) =>
          open({
            type: "file",
            title: getPathLeaf(target.path),
            path: target.path,
            workspacePath: target.workspacePath,
            workspaceIdentity: target.workspaceIdentity,
            workspaceRemoteSessionId: target.workspaceRemoteSessionId,
          }),
      })}
      <Dialog
        open={Boolean(source)}
        onOpenChange={(isOpen) => {
          if (!isOpen) close();
        }}
      >
        {source ? (
          <DialogContent
            showCloseButton={false}
            data-testid="agent-board-file-preview"
            className="flex h-[92dvh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
              <DialogTitle className="min-w-0 flex-1 truncate">{source.title}</DialogTitle>
              <DialogDescription className="sr-only">
                {source.path ?? source.title}
              </DialogDescription>
              <Button
                variant="ghost"
                size="icon"
                aria-label={intl.formatMessage({ id: "codeViewer.close" })}
                onClick={close}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense
                fallback={<p className="p-4">{intl.formatMessage({ id: "agentBoard.loading" })}</p>}
              >
                <PreviewPane
                  source={source}
                  workspacePath={source.workspacePath}
                  onClose={close}
                  onOpenCodeViewer={open}
                  onOpenBrowserUrl={onOpenBrowserUrl}
                />
              </Suspense>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
