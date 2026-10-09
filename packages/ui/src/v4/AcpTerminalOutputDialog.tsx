import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { useAcpTerminalPanel } from "@/hooks/useAcpTerminalPanel.js";

export function AcpTerminalOutputDialog({
  panel,
  readOnly,
}: {
  panel: ReturnType<typeof useAcpTerminalPanel>;
  readOnly: boolean;
}) {
  const { intl } = useZCodeIntl();
  const { terminal, tool } = panel;
  const title = terminal?.title ?? tool?.title ?? "";
  const details = terminal ? [terminal.output] : [tool?.input, tool?.content, tool?.output];
  const text = details
    .filter((s, index, all) => typeof s === "string" && s.length > 0 && all.indexOf(s) === index)
    .join("\n\n");
  return (
    <>
      {panel.error ? (
        <p role="alert" className="text-ui-base text-destructive">
          {intl.formatMessage({ id: panel.error })}
        </p>
      ) : null}
      <Dialog
        open={Boolean(terminal || tool)}
        onOpenChange={(open) => {
          if (!open) panel.close();
        }}
      >
        <DialogContent className="sm:max-w-3xl" data-testid="acp-terminal-output">
          <DialogHeader>
            <DialogTitle className="pr-8 break-words">{title}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: "acp.terminalOutputDescription" })}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-3 font-mono text-ui-sm">
            {text}
          </pre>
          {terminal?.truncated ||
          tool?.inputTruncated ||
          tool?.outputTruncated ||
          tool?.contentTruncated ? (
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "acp.terminalOutputTruncated" })}
            </p>
          ) : null}
          {terminal?.status === "running" && !readOnly && panel.workId ? (
            <Button variant="outline" onClick={() => panel.stop(panel.workId!)}>
              {intl.formatMessage({ id: "acp.terminalStop" })}
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
