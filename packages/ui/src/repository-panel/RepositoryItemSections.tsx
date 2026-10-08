import { useMemo, useState } from "react";
import { Activity, Check, ChevronRight, CircleMinus, Clock3, FileDiff, Tag, X } from "lucide-react";
import type { ForgeChangedFile, ForgeCheck, ForgeItemDetail } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { LightweightDiffPreview } from "@/components/ui/lightweight-diff-preview.js";
import { getPlainTextPatchPreviewLines } from "@/lib/patchDiffPreview.js";
import type { CodePreviewSettings } from "@/lib/codePreviewSettings.js";
import type { Theme } from "@/useTheme.js";
import type { useRepositoryItem } from "@/hooks/useRepositoryItem.js";
import { RepositoryMarkdown, type RepositoryContentContext } from "./RepositoryMarkdown.js";
import { RepositoryLabelActivity } from "./RepositoryLabelActivity.js";
import {
  RepositoryAuthor,
  RepositoryError,
  RepositoryExternalButton,
  RepositoryLoading,
  RepositoryItemIcon,
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

interface RepositoryItemSectionsProps {
  item: ForgeItemDetail;
  detail: ReturnType<typeof useRepositoryItem>;
  context: RepositoryContentContext;
  theme: Theme;
  codePreviewSettings: CodePreviewSettings;
  onOpen: (url: string) => void;
  withExtras: boolean;
}

function RepositoryConversation({
  item,
  detail,
  context,
  theme,
  codePreviewSettings,
  onOpen,
  withExtras,
}: RepositoryItemSectionsProps) {
  const t = useRepositoryMessages();
  const [activityFilter, setActivityFilter] = useState("all");
  const metadata = item.metadata;
  const comments =
    detail.comments?.items.filter((comment) => activityFilter === "all" || !comment.system) ?? [];
  return (
    <div className="min-w-0">
      <RepositoryMarkdown context={context} theme={theme} codePreviewSettings={codePreviewSettings}>
        {item.body || t("noDescription")}
      </RepositoryMarkdown>
      {metadata?.taskStatus && metadata.taskStatus.total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 text-ui-sm text-foreground-subtle">
          <span>{t("tasks")}</span>
          <span className="tabular-nums">
            {metadata.taskStatus.completed} / {metadata.taskStatus.total}
          </span>
        </div>
      ) : null}
      {metadata?.linkedItems !== undefined || withExtras ? (
        <section
          data-testid="repository-links"
          className="mt-5 min-w-0 border-t border-border pt-4"
        >
          <h2 className="mb-2 text-ui-base font-medium">{t("linkedIssues")}</h2>
          {metadata?.errors?.links ? (
            <RepositoryError error={metadata.errors.links} retry={detail.refresh} />
          ) : detail.extrasError ? (
            <RepositoryError error={detail.extrasError} retry={detail.refresh} />
          ) : detail.extrasLoading ? (
            <RepositoryLoading />
          ) : metadata?.linkedItems?.length ? (
            <ul className="min-w-0 divide-y divide-border">
              {metadata.linkedItems.map((link) => (
                <li key={link.number} className="flex min-w-0 items-center gap-2 py-2 text-ui-sm">
                  <RepositoryItemIcon item={{ kind: "issue", state: link.state, draft: false }} />
                  <span className="shrink-0 text-foreground-subtle">#{link.number}</span>
                  <span className="min-w-0 flex-1 break-words">{link.title}</span>
                  <RepositoryExternalButton url={link.url} label={t("openItem")} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-ui-sm text-foreground-subtle">{t("noLinkedIssues")}</p>
          )}
          {metadata?.linkedItemsHasMore ? (
            <p className="mt-2 text-ui-sm text-foreground-subtle">{t("moreOnWeb")}</p>
          ) : null}
        </section>
      ) : null}
      <div className="mt-6 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
        <h2 className="text-ui-base font-medium">{t("activity")}</h2>
        <Select value={activityFilter} onValueChange={setActivityFilter}>
          <SelectTrigger aria-label={t("activityFilter")} className="max-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allActivity")}</SelectItem>
            <SelectItem value="comments">{t("commentsOnly")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {detail.commentsError ? (
        <RepositoryError error={detail.commentsError} retry={detail.refresh} />
      ) : detail.comments ? (
        <>
          {comments.length ? (
            comments.map((comment) =>
              comment.system ? (
                <div
                  key={comment.id}
                  data-testid="repository-system-note"
                  className="flex min-w-0 items-start gap-3 border-b border-border py-3"
                >
                  {comment.labelActivity ? (
                    <Tag className="mt-1 size-4 shrink-0 text-foreground-subtle" />
                  ) : (
                    <Activity className="mt-1 size-4 shrink-0 text-foreground-subtle" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-2 text-ui-sm text-foreground-subtle">
                      <RepositoryAuthor author={comment.author} />
                      <RepositoryTime value={comment.createdAt} />
                    </div>
                    {comment.labelActivity ? (
                      <RepositoryLabelActivity activity={comment.labelActivity} />
                    ) : (
                      <RepositoryMarkdown
                        context={context}
                        theme={theme}
                        codePreviewSettings={codePreviewSettings}
                      >
                        {comment.body || t("emptyComment")}
                      </RepositoryMarkdown>
                    )}
                  </div>
                </div>
              ) : (
                <section key={comment.id} className="min-w-0 border-b border-border py-4">
                  <header className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-ui-sm text-foreground-subtle">
                    <span className="min-w-0 flex-1 text-foreground">
                      <RepositoryAuthor author={comment.author} />
                    </span>
                    <RepositoryTime value={comment.createdAt} />
                    <RepositoryExternalButton
                      url={comment.url}
                      label={t("openComment")}
                      onOpen={onOpen}
                    />
                  </header>
                  <RepositoryMarkdown
                    context={context}
                    theme={theme}
                    codePreviewSettings={codePreviewSettings}
                  >
                    {comment.body || t("emptyComment")}
                  </RepositoryMarkdown>
                </section>
              ),
            )
          ) : (
            <p className="py-4 text-ui-sm text-foreground-subtle">
              {t(
                activityFilter === "all"
                  ? "noActivity"
                  : detail.comments.hasMore || detail.comments.items.length
                    ? "noCommentsOnPage"
                    : "noComments",
              )}
            </p>
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
    </div>
  );
}

export function RepositoryItemSections({
  item,
  detail,
  theme,
  codePreviewSettings,
  onOpen,
  context,
  withExtras,
}: RepositoryItemSectionsProps) {
  const t = useRepositoryMessages();
  const conversation = (
    <RepositoryConversation
      item={item}
      detail={detail}
      context={context}
      theme={theme}
      codePreviewSettings={codePreviewSettings}
      onOpen={onOpen}
      withExtras={withExtras}
    />
  );
  if (!item.change) return conversation;
  return (
    <Tabs defaultValue="conversation" className="min-w-0">
      <TabsList variant="line" className="sticky top-0 z-10 bg-background">
        <TabsTrigger value="conversation">{t("conversation")}</TabsTrigger>
        {item.change ? (
          <>
            <TabsTrigger value="files">{t("files")}</TabsTrigger>
            <TabsTrigger value="checks">{t("checks")}</TabsTrigger>
          </>
        ) : null}
      </TabsList>
      <TabsContent value="conversation" className="min-w-0 pt-4">
        {conversation}
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
