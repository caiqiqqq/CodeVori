import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  useConversationVisualization,
  type ConversationVisualizationScope,
} from "@/hooks/useConversationVisualization.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ConversationVisualizationReference } from "@/lib/conversationVisualizations.js";
import {
  buildVisualizationDocument,
  resolveVisualizationHeight,
} from "@/lib/visualizationDocument.js";
import { resolveTheme, type Theme } from "@/useTheme.js";

export const ConversationVisualization = memo(function ConversationVisualization({
  reference,
  theme = "system",
  ...scope
}: ConversationVisualizationScope & {
  reference: ConversationVisualizationReference;
  theme?: Theme;
}) {
  const { intl } = useZCodeIntl();
  const { content, failed, retry } = useConversationVisualization(scope, reference.path);
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (theme !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : resolveTheme(theme);
  const document = useMemo(
    () => (content === null ? null : buildVisualizationDocument(content, resolvedTheme)),
    [content, resolvedTheme],
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const [measurement, setMeasurement] = useState<{ document: string; height: number } | null>(null);
  useEffect(() => {
    if (document === null) return;
    const receive = (event: MessageEvent) => {
      // 修复原因：sandbox 使用 opaque origin；必须验证精确 frame window，不能按 origin="null" 信任广播。
      if (event.source !== frame.current?.contentWindow) return;
      const height = resolveVisualizationHeight(event.data);
      if (height !== null)
        setMeasurement((previous) =>
          previous?.document === document && previous.height === height
            ? previous
            : { document, height },
        );
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [document]);
  const title = reference.title || intl.formatMessage({ id: "chat.visualization.title" });
  return (
    <section
      data-testid="conversation-visualization"
      data-mode={reference.mode}
      className={`mx-auto w-full min-w-0 ${reference.mode === "wide" ? "max-w-5xl" : "max-w-3xl"}`}
      aria-label={title}
    >
      {document !== null ? (
        <iframe
          key={document}
          ref={frame}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={document}
          className="block w-full border-0"
          style={{ height: measurement?.document === document ? measurement.height : 320 }}
        />
      ) : failed ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 text-ui-base text-foreground-secondary"
        >
          <span>{intl.formatMessage({ id: "chat.visualization.failed" })}</span>
          <Button variant="outline" size="sm" onClick={retry}>
            {intl.formatMessage({ id: "chat.visualization.retry" })}
          </Button>
        </div>
      ) : (
        <div role="status" className="p-3 text-ui-base text-foreground-secondary">
          {intl.formatMessage({ id: "chat.visualization.loading" })}
        </div>
      )}
    </section>
  );
});
