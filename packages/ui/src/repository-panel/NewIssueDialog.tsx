import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { IGitService } from "@zcode/services";
import type { ForgeIssueDraft, ForgeRepository, ForgeTargetRequest } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { useForgeIssueOptions } from "@/hooks/useForgeIssueOptions.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { resolveForgeContentUrl } from "@/lib/forgeContent.js";
import type { Theme } from "@/useTheme.js";
import { NewIssueAttributes } from "./NewIssueAttributes.js";
import { RepositoryError, useRepositoryMessages } from "./RepositoryParts.js";

export function NewIssueDialog({
  open,
  repository,
  target,
  gitService,
  theme,
  busy,
  error,
  onClose,
  onSubmit,
  onOpen,
}: {
  open: boolean;
  repository: ForgeRepository;
  target: ForgeTargetRequest;
  gitService: IGitService;
  theme: Theme;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: ForgeIssueDraft) => Promise<void>;
  onOpen: (url: string) => void;
}) {
  const t = useRepositoryMessages();
  const [draft, setDraft] = useState<ForgeIssueDraft>({ title: "", body: "" });
  const [mode, setMode] = useState("write");
  const options = useForgeIssueOptions(gitService, target, open);
  const codePreviewSettings = useZCodeStore((state) => state.codePreviewSettings);
  const webContent = useMemo(
    () => ({
      resolveUrl: (href: string) => resolveForgeContentUrl(repository, repository.url, href),
      // 未创建的正文没有 item 身份；预览图片只提供网页链接，不伪造议题号读取私有附件。
      renderImage: (props: { src?: string; alt?: string }) => {
        const url = props.src
          ? resolveForgeContentUrl(repository, repository.url, props.src)
          : null;
        return url ? (
          <Button
            type="button"
            variant="link"
            className="max-w-full whitespace-normal break-all"
            onClick={() => onOpen(url)}
          >
            {props.alt || t("image")}
          </Button>
        ) : null;
      },
    }),
    [repository, onOpen],
  );
  const update = (patch: Partial<ForgeIssueDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogTitle>{t("newIssue")}</DialogTitle>
        <DialogDescription className="break-all text-ui-sm">{repository.name}</DialogDescription>
        <form
          data-testid="repository-new-issue"
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && draft.title.trim()) void onSubmit({ ...draft, title: draft.title.trim() });
          }}
        >
          <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-ui-sm">
                {t("titleField")}
                <Input
                  size="lg"
                  autoFocus
                  required
                  maxLength={256}
                  value={draft.title}
                  disabled={busy}
                  className="text-mobile-input-safe md:text-ui-base"
                  onChange={(event) => update({ title: event.target.value })}
                />
              </label>
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="repository-issue-body" className="text-ui-sm">
                    {t("description")}
                  </label>
                  <Tabs value={mode} onValueChange={setMode}>
                    <TabsList>
                      <TabsTrigger value="write">{t("write")}</TabsTrigger>
                      <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                {/* 编辑区保持挂载，预览切换不会丢失正文或影响浏览器的表单校验。 */}
                <div hidden={mode !== "write"}>
                  <Textarea
                    id="repository-issue-body"
                    rows={8}
                    maxLength={65000}
                    value={draft.body}
                    disabled={busy}
                    // 通用 Textarea 的弱边框在弹窗同色背景中不可辨识；使用表单输入的语义边框和表面。
                    className="field-sizing-fixed min-h-32 resize-y rounded-lg border border-input-border bg-input hover:border-input-border-hover focus-visible:border-input-border-focused focus-visible:bg-input-focused text-mobile-input-safe md:min-h-56 md:text-ui-base"
                    onChange={(event) => update({ body: event.target.value })}
                  />
                </div>
                {mode === "preview" ? (
                  <div
                    data-testid="repository-issue-preview"
                    className="min-h-64 min-w-0 overflow-x-auto rounded-lg border border-border bg-surface p-3"
                  >
                    {draft.body.trim() ? (
                      <MessageResponse
                        theme={theme}
                        codePreviewSettings={codePreviewSettings}
                        onOpenExternalUrl={onOpen}
                        webContent={webContent}
                        className="[&_p]:break-words [overflow-wrap:anywhere] tracking-normal"
                      >
                        {draft.body}
                      </MessageResponse>
                    ) : (
                      <span className="text-ui-sm text-foreground-subtle">{t("emptyPreview")}</span>
                    )}
                  </div>
                ) : null}
                <span className="text-ui-xs text-foreground-subtle">{t("markdownSupported")}</span>
              </div>
            </div>
            <NewIssueAttributes
              provider={repository.provider}
              options={options.data}
              loading={options.loading}
              error={options.error}
              draft={draft}
              disabled={busy}
              onChange={update}
              onRetry={options.retry}
            />
          </div>
          {error ? <RepositoryError error={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !draft.title.trim()}>
              <Plus className="size-4" />
              {t(busy ? "creating" : "create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
