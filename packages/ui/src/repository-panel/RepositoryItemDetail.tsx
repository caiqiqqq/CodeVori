import { useMemo, useState } from "react";
import { ArrowLeft, Bot, CircleCheck, GitMerge, RotateCw, Send } from "lucide-react";
import type { IGitService } from "@zcode/services";
import { isWorkTaskForgePending } from "@zcode/shared";
import type {
  ForgeItem,
  ForgeItemRequest,
  ForgeMergeMethod,
  ForgeRepository,
  WorkTask,
} from "@zcode/shared";
import { useRepositoryItem } from "@/hooks/useRepositoryItem.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Textarea } from "@/components/ui/textarea.js";
import type { Theme } from "@/useTheme.js";
import { RepositoryTaskStatus } from "./RepositoryTaskStatus.js";
import { RepositoryItemSections } from "./RepositoryItemSections.js";
import { RepositoryItemAttributes } from "./RepositoryItemAttributes.js";
import type { RepositoryContentContext } from "./RepositoryMarkdown.js";
import {
  RepositoryAuthor,
  RepositoryError,
  RepositoryExternalButton,
  RepositoryIconButton,
  RepositoryItemStatus,
  RepositoryLoading,
  RepositoryTime,
  useRepositoryMessages,
} from "./RepositoryParts.js";

type Confirmation =
  | { action: "open" | "closed" }
  | { action: "merge"; headSha: string; method: ForgeMergeMethod };

export function RepositoryItemDetail({
  request,
  repository,
  gitService,
  theme,
  active = true,
  onClose,
  onChanged,
  onHandle,
  onHandleAgain,
  handleBusy = false,
  getLinkedTask,
  writebackVersion = "",
  taskError = null,
  onOpen,
}: {
  request: ForgeItemRequest;
  repository: ForgeRepository;
  gitService: IGitService;
  theme: Theme;
  active?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onHandle: (item: ForgeItem) => void;
  onHandleAgain?: (item: ForgeItem) => void;
  handleBusy?: boolean;
  writebackVersion?: string;
  getLinkedTask?: (item: ForgeItem) => WorkTask | undefined;
  taskError?: string | null;
  onOpen: (url: string) => void;
}) {
  const t = useRepositoryMessages();
  const withExtras = repository.provider === "gitlab" && request.kind === "issue";
  const detail = useRepositoryItem(request, gitService, withExtras, writebackVersion);
  const codePreviewSettings = useZCodeStore((state) => state.codePreviewSettings);
  const [comment, setComment] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<ForgeMergeMethod>("merge");
  const item = detail.item;
  const contentContext = useMemo<RepositoryContentContext>(
    () => ({
      request,
      repository,
      gitService,
      itemUrl: item?.url ?? null,
      active,
      onOpen,
    }),
    [request, repository, gitService, item?.url, active, onOpen],
  );
  const change = item?.change;
  const method = change?.mergeMethods.includes(selectedMethod)
    ? selectedMethod
    : (change?.mergeMethods[0] ?? "merge");
  const mergeReady = Boolean(
    item?.state === "open" &&
    !item.draft &&
    change?.mergeable === true &&
    change.mergeMethods.length &&
    /^[a-f\d]{40,64}$/i.test(change.headSha),
  );
  const submitConfirmation = async () => {
    if (!confirmation || detail.mutation.busy) return;
    const success =
      confirmation.action === "merge"
        ? await detail.merge(confirmation.headSha, confirmation.method)
        : await detail.setItemState(confirmation.action);
    if (success) {
      setConfirmation(null);
      onChanged();
    }
  };
  return (
    <section
      data-testid="repository-item-detail"
      aria-label={item?.title ?? `#${request.number}`}
      aria-busy={detail.loading}
      className="@container flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="shrink-0 border-b border-border px-4 pb-4 md:px-6">
        <div className="mb-2 flex min-w-0 items-center gap-2 text-ui-sm text-foreground-subtle">
          <RepositoryIconButton label={t("closeDetail")} onClick={onClose}>
            <ArrowLeft className="size-4" />
          </RepositoryIconButton>
          <span className="min-w-0 break-all">
            {t(
              request.kind === "issue"
                ? "issues"
                : repository.provider === "gitlab"
                  ? "mergeRequests"
                  : "pullRequests",
            )}{" "}
            / #{request.number}
          </span>
        </div>
        <h1 className="break-words text-ui-lg font-medium [overflow-wrap:anywhere]">
          {item?.title ?? `#${request.number}`}
        </h1>
        {item ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui-sm text-foreground-subtle">
              <RepositoryItemStatus item={item} />
              <span className="inline-flex min-w-0 items-center gap-2">
                <span>{t("openedBy")}</span>
                <RepositoryAuthor author={item.author} />
              </span>
              <RepositoryTime value={item.createdAt} />
            </div>
            {change ? (
              <div className="mt-2 flex flex-wrap gap-2 text-ui-sm text-foreground-subtle">
                <span className="break-all font-mono">{change.headBranch}</span>
                <span aria-hidden="true">→</span>
                <span className="break-all font-mono">{change.baseBranch}</span>
              </div>
            ) : null}
            {taskError ? <RepositoryError error={taskError} /> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={handleBusy}
                onClick={() => onHandle(item)}
              >
                <Bot className="size-4" />
                {getLinkedTask?.(item) ? (
                  <RepositoryTaskStatus task={getLinkedTask(item)!} />
                ) : (
                  t("handle")
                )}
              </Button>
              {getLinkedTask?.(item)?.status === "done" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={handleBusy || isWorkTaskForgePending(getLinkedTask(item)!)}
                  onClick={() => onHandleAgain?.(item)}
                >
                  {t("reprocess")}
                </Button>
              ) : null}
              {item.state !== "merged" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={detail.mutation.busy}
                  onClick={() =>
                    setConfirmation({ action: item.state === "open" ? "closed" : "open" })
                  }
                >
                  <CircleCheck className="size-4" />
                  {t(
                    item.state === "open"
                      ? item.kind === "issue"
                        ? "closeIssue"
                        : "closeRequest"
                      : "reopen",
                  )}
                </Button>
              ) : null}
              {item.state === "open" && change ? (
                <>
                  <Select
                    value={method}
                    disabled={detail.mutation.busy || !change.mergeMethods.length}
                    onValueChange={(value) => setSelectedMethod(value as ForgeMergeMethod)}
                  >
                    <SelectTrigger aria-label={t("mergeMethod")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(change.mergeMethods.length
                        ? change.mergeMethods
                        : (["merge"] as const)
                      ).map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`mergeMethod.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    disabled={!mergeReady || detail.mutation.busy}
                    onClick={() =>
                      setConfirmation({ action: "merge", headSha: change.headSha, method })
                    }
                  >
                    <GitMerge className="size-4" />
                    {t("merge")}
                  </Button>
                </>
              ) : null}
              <RepositoryExternalButton url={item.url} label={t("openItem")} onOpen={onOpen} />
              <RepositoryIconButton
                label={t("refreshDetail")}
                disabled={detail.loading || detail.mutation.busy}
                onClick={detail.refresh}
              >
                <RotateCw className="size-4" />
              </RepositoryIconButton>
            </div>
            {item.state === "open" && change && !mergeReady ? (
              <p className="mt-2 text-ui-sm text-foreground-subtle">
                {t(
                  item.draft
                    ? "mergeDraft"
                    : change.mergeable === null
                      ? "mergeUnknown"
                      : !change.mergeMethods.length
                        ? "mergeUnavailable"
                        : "mergeBlocked",
                )}
              </p>
            ) : null}
            {change?.mergeOptionsError ? (
              <RepositoryError error={change.mergeOptionsError} retry={detail.refresh} />
            ) : null}
          </>
        ) : null}
      </header>
      <div
        data-testid="repository-detail-scroll"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 md:px-6 [scrollbar-gutter:stable]"
      >
        {detail.error ? (
          <RepositoryError error={detail.error} retry={detail.refresh} />
        ) : item ? (
          <div className="grid min-w-0 grid-cols-1 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="min-w-0">
              <RepositoryItemSections
                item={item}
                detail={detail}
                context={contentContext}
                theme={theme}
                codePreviewSettings={codePreviewSettings}
                onOpen={onOpen}
                withExtras={withExtras}
              />
              <form
                className="mt-6 min-w-0 border-t border-border pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!comment.trim() || detail.mutation.busy) return;
                  void detail.createComment(comment.trim()).then((success) => {
                    if (success) {
                      setComment("");
                      onChanged();
                    }
                  });
                }}
              >
                {!confirmation && detail.mutation.error ? (
                  <RepositoryError error={detail.mutation.error} />
                ) : null}
                <Textarea
                  aria-label={t("comments")}
                  placeholder={t("commentPlaceholder")}
                  rows={4}
                  maxLength={65000}
                  value={comment}
                  disabled={detail.mutation.busy}
                  className="max-h-60 field-sizing-fixed resize-y text-mobile-input-safe md:text-ui-base"
                  onChange={(event) => setComment(event.target.value)}
                />
                <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-all text-ui-sm text-foreground-subtle">
                    {t("commentAs", { name: repository.accountUsername })}
                  </span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!comment.trim() || detail.mutation.busy}
                  >
                    <Send className="size-3.5" />
                    {t(detail.mutation.busy ? "submitting" : "submitComment")}
                  </Button>
                </div>
              </form>
            </div>
            <RepositoryItemAttributes
              item={item}
              detail={detail}
              withExtras={withExtras}
              onOpen={onOpen}
            />
          </div>
        ) : (
          <RepositoryLoading />
        )}
      </div>
      <Dialog
        open={active && Boolean(confirmation)}
        onOpenChange={(next) => {
          if (!next && !detail.mutation.busy) setConfirmation(null);
        }}
      >
        <DialogContent data-testid="repository-confirm" className="sm:max-w-md">
          <DialogTitle>
            {t(
              confirmation?.action === "merge"
                ? "confirmMerge"
                : confirmation?.action === "open"
                  ? "confirmReopen"
                  : "confirmClose",
            )}
          </DialogTitle>
          <DialogDescription className="break-words text-ui-sm">
            {t("confirmBody", { repository: repository.name, number: request.number })}
          </DialogDescription>
          {confirmation?.action === "merge" ? (
            <p className="break-all font-mono text-ui-sm text-foreground-subtle">
              {t(`mergeMethod.${confirmation.method}`)} · {confirmation.headSha.slice(0, 12)}
            </p>
          ) : null}
          {detail.mutation.error ? <RepositoryError error={detail.mutation.error} /> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={detail.mutation.busy}
              onClick={() => setConfirmation(null)}
            >
              {t("cancel")}
            </Button>
            <Button disabled={detail.mutation.busy} onClick={() => void submitConfirmation()}>
              {t(
                confirmation?.action === "merge"
                  ? "confirmMerge"
                  : confirmation?.action === "open"
                    ? "confirmReopen"
                    : "confirmClose",
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
