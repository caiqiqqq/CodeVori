import { useMemo, useState } from "react";
import { Check, ChevronRight, CircleMinus, Clock3, FileDiff, X } from "lucide-react";
import type { ForgeChangedFile, ForgeCheck, ForgeItemDetail } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { LightweightDiffPreview } from "@/components/ui/lightweight-diff-preview.js";
import { getPlainTextPatchPreviewLines } from "@/lib/patchDiffPreview.js";
import type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
import type { Theme } from "@/useTheme.js";
import type { useRepositoryItem } from "@/hooks/useRepositoryItem.js";
import {
  RepositoryError,
  RepositoryExternalButton,
  RepositoryLoading,
  RepositoryTime,
  useRepositoryMessages,
} from "./RepositoryParts.js";

function RepositoryChangedFile({
  file,
  codePreviewSettings,
}: {
  file: ForgeChangedFile;
  codePreviewSettings: CodePreviewSettings;
}) {
  const t = useRepositoryMessages();
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(
    () => (expanded && file.patch ? getPlainTextPatchPreviewLines(file.patch) : []),
    [expanded, file.patch],
  );
  return (
    <details
      className="group min-w-0 border-b border-border"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 py-3 text-ui-sm hover:bg-hover [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 group-open:rotate-90" />
        <FileDiff className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0 flex-1 break-all font-mono">
          {file.previousPath ? `${file.previousPath} → ` : ""}
          {file.path}
        </span>
        <span className="shrink-0 tabular-nums text-diff-added">+{file.additions}</span>
        <span className="shrink-0 tabular-nums text-diff-removed">-{file.deletions}</span>
      </summary>
      {expanded ? (
        <div className="min-w-0 pb-3">
          {file.patch ? (
            <LightweightDiffPreview lines={lines} codePreviewSettings={codePreviewSettings} />
          ) : (
            <p className="text-ui-sm text-foreground-subtle">{t("noPatch")}</p>
          )}
          {file.truncated ? (
            <p className="pt-2 text-ui-sm text-foreground-subtle">{t("truncatedPatch")}</p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function RepositoryCheckRow({
  check,
  onOpen,
}: {
  check: ForgeCheck;
  onOpen: (url: string) => void;
}) {
  const t = useRepositoryMessages();
  const Icon =
    check.state === "success"
      ? Check
      : check.state === "failure"
        ? X
        : check.state === "pending"
          ? Clock3
          : CircleMinus;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border py-2">
      <Icon
        className={`size-4 shrink-0 ${check.state === "success" ? "text-success" : check.state === "failure" ? "text-destructive" : "text-foreground-subtle"}`}
      />
      <span className="min-w-0 flex-1 break-words text-ui-base">{check.name}</span>
      <span className="text-ui-sm text-foreground-subtle">{t(`check.${check.state}`)}</span>
      <RepositoryExternalButton url={check.url} label={t("openCheck")} onOpen={onOpen} />
    </div>
  );
}

export function RepositoryItemSections({
  item,
  detail,
  theme,
  codePreviewSettings,
  onOpen,
}: {
  item: ForgeItemDetail;
  detail: ReturnType<typeof useRepositoryItem>;
  theme: Theme;
  codePreviewSettings: CodePreviewSettings;
  onOpen: (url: string) => void;
}) {
  const t = useRepositoryMessages();
  return (
    <Tabs defaultValue="conversation" className="min-w-0">
      <TabsList variant="line" className="sticky top-0 z-10 bg-popover">
        <TabsTrigger value="conversation">{t("conversation")}</TabsTrigger>
        {item.change ? (
          <>
            <TabsTrigger value="files">{t("files")}</TabsTrigger>
            <TabsTrigger value="checks">{t("checks")}</TabsTrigger>
          </>
        ) : null}
      </TabsList>
      <TabsContent value="conversation" className="min-w-0 pt-4">
        <MessageResponse
          theme={theme}
          codePreviewSettings={codePreviewSettings}
          onOpenExternalUrl={onOpen}
        >
          {item.body || t("noDescription")}
        </MessageResponse>
        <h3 className="mt-6 border-b border-border pb-2 text-ui-base font-medium">
          {t("comments")}
        </h3>
        {detail.commentsError ? (
          <RepositoryError error={detail.commentsError} retry={detail.refresh} />
        ) : detail.comments ? (
          <>
            {detail.comments.items.length ? (
              detail.comments.items.map((comment) => (
                <section key={comment.id} className="min-w-0 border-b border-border py-4">
                  <header className="mb-2 flex items-center gap-2 text-ui-sm text-foreground-subtle">
                    <span className="min-w-0 flex-1 break-all font-medium text-foreground">
                      {comment.author.username}
                    </span>
                    <RepositoryTime value={comment.createdAt} />
                    <RepositoryExternalButton
                      url={comment.url}
                      label={t("openComment")}
                      onOpen={onOpen}
                    />
                  </header>
                  <MessageResponse
                    theme={theme}
                    codePreviewSettings={codePreviewSettings}
                    onOpenExternalUrl={onOpen}
                  >
                    {comment.body || t("emptyComment")}
                  </MessageResponse>
                </section>
              ))
            ) : (
              <p className="py-4 text-ui-sm text-foreground-subtle">{t("noComments")}</p>
            )}
            {detail.comments.hasMore ? (
              <Button
                variant="outline"
                className="mt-3"
                disabled={detail.mutation.busy}
                onClick={() => void detail.loadMore("comments")}
              >
                {t("loadMore")}
              </Button>
            ) : null}
          </>
        ) : (
          <RepositoryLoading />
        )}
      </TabsContent>
      {item.change ? (
        <>
          <TabsContent value="files" className="min-w-0 pt-3">
            {detail.filesError ? (
              <RepositoryError error={detail.filesError} retry={detail.refresh} />
            ) : detail.files ? (
              <>
                {detail.files.items.length ? (
                  detail.files.items.map((file) => (
                    <RepositoryChangedFile
                      key={file.path}
                      file={file}
                      codePreviewSettings={codePreviewSettings}
                    />
                  ))
                ) : (
                  <p className="py-4 text-ui-sm text-foreground-subtle">{t("noFiles")}</p>
                )}
                {detail.files.hasMore ? (
                  <Button
                    className="mt-3"
                    variant="outline"
                    disabled={detail.mutation.busy}
                    onClick={() => void detail.loadMore("files")}
                  >
                    {t("loadMore")}
                  </Button>
                ) : null}
              </>
            ) : (
              <RepositoryLoading />
            )}
          </TabsContent>
          <TabsContent value="checks" className="min-w-0 pt-3">
            {item.change.checksError ? (
              <RepositoryError error={item.change.checksError} retry={detail.refresh} />
            ) : null}
            {item.change.checks.map((check) => (
              <RepositoryCheckRow key={check.id} check={check} onOpen={onOpen} />
            ))}
            {!item.change.checks.length && !item.change.checksError ? (
              <p className="py-4 text-ui-sm text-foreground-subtle">{t("noChecks")}</p>
            ) : null}
          </TabsContent>
        </>
      ) : null}
    </Tabs>
  );
}
