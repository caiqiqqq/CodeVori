import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import type { IGitService } from "@zcode/services";
import type {
  ForgeIssueOptions,
  ForgeItemDetail,
  ForgeRepository,
  ForgeTargetRequest,
  ForgeUpdateIssueRequest,
} from "@zcode/shared";
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
import { resolveForgeContentUrl } from "@/lib/forgeContent.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import type { Theme } from "@/useTheme.js";
import { NewIssueAttributes } from "./NewIssueAttributes.js";
import { RepositoryError, useRepositoryMessages } from "./RepositoryParts.js";

type EditDraft = Omit<ForgeUpdateIssueRequest, keyof ForgeTargetRequest | "kind" | "number">;

function draftFromItem(item: ForgeItemDetail, provider: ForgeRepository["provider"]): EditDraft {
  return {
    title: item.title,
    body: item.body,
    labels: item.labels.map((label) => label.key),
    assignees: item.metadata?.assignees.map((author) => author.username) ?? [],
    milestone: item.metadata?.milestone?.title ?? null,
    ...(provider === "gitlab" && item.metadata?.dueDate !== undefined
      ? { dueDate: item.metadata.dueDate }
      : {}),
    ...(provider === "gitlab" &&
    item.metadata?.confidential !== undefined &&
    item.metadata.confidential !== null
      ? { confidential: item.metadata.confidential }
      : {}),
  };
}

function resolveCatalogKeys(draft: EditDraft, options: ForgeIssueOptions | null): EditDraft {
  if (!options) return draft;
  const assignees = draft.assignees.map(
    (key) =>
      options.assignees.items.find((user) => user.key === key)?.key ??
      options.assignees.items.find((user) => user.username === key)?.key ??
      key,
  );
  const milestone = draft.milestone;
  const milestoneKey = milestone
    ? (options.milestones.items.find((entry) => entry.key === milestone)?.key ??
      options.milestones.items.find((entry) => entry.title === milestone)?.key ??
      milestone)
    : null;
  return { ...draft, assignees, milestone: milestoneKey };
}

export function EditIssueDialog({
  open,
  repository,
  target,
  gitService,
  theme,
  item,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  repository: ForgeRepository;
  target: ForgeTargetRequest;
  gitService: IGitService;
  theme: Theme;
  item: ForgeItemDetail;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: EditDraft) => Promise<boolean>;
}) {
  const t = useRepositoryMessages();
  const [draft, setDraft] = useState<EditDraft>(() => draftFromItem(item, repository.provider));
  const [mode, setMode] = useState("write");
  const options = useForgeIssueOptions(gitService, target, open);
  const codePreviewSettings = useZCodeStore((state) => state.codePreviewSettings);
  useEffect(() => {
    if (open) setDraft(draftFromItem(item, repository.provider));
  }, [open, item.number, repository.provider]);
  useEffect(() => {
    if (open && options.data) setDraft((current) => resolveCatalogKeys(current, options.data));
  }, [open, options.data]);
  const update = (patch: Partial<EditDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const preview = useMemo(
    () => ({
      resolveUrl: (href: string) => resolveForgeContentUrl(repository, repository.url, href),
      renderImage: ({ src, alt }: { src?: string; alt?: string }) =>
        src ? <img src={src} alt={alt ?? ""} className="max-w-full" /> : null,
    }),
    [repository],
  );
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogTitle>{t("editIssue")}</DialogTitle>
        <DialogDescription className="break-all text-ui-sm">
          {repository.name} #{item.number}
        </DialogDescription>
        <form
          data-testid="repository-edit-issue"
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && draft.title.trim() && draft.body.length <= 65000)
              void onSubmit({ ...draft, title: draft.title.trim() });
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
                  <label htmlFor="repository-edit-issue-body" className="text-ui-sm">
                    {t("description")}
                  </label>
                  <Tabs value={mode} onValueChange={setMode}>
                    <TabsList>
                      <TabsTrigger value="write">{t("write")}</TabsTrigger>
                      <TabsTrigger value="preview">{t("preview")}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                {mode === "write" ? (
                  <Textarea
                    id="repository-edit-issue-body"
                    rows={10}
                    maxLength={65000}
                    value={draft.body}
                    disabled={busy}
                    className="field-sizing-fixed min-h-32 resize-y rounded-lg border border-input-border bg-input text-mobile-input-safe md:min-h-56 md:text-ui-base"
                    onChange={(event) => update({ body: event.target.value })}
                  />
                ) : (
                  <div
                    data-testid="repository-edit-issue-preview"
                    className="min-h-64 min-w-0 overflow-x-auto rounded-lg border border-border bg-surface p-3"
                  >
                    {draft.body ? (
                      <MessageResponse
                        theme={theme}
                        codePreviewSettings={codePreviewSettings}
                        webContent={preview}
                      >
                        {draft.body}
                      </MessageResponse>
                    ) : (
                      <span className="text-ui-sm text-foreground-subtle">{t("emptyPreview")}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <NewIssueAttributes
              provider={repository.provider}
              options={options.data}
              loading={options.loading}
              error={options.error}
              draft={{
                ...draft,
                milestone: draft.milestone ?? undefined,
                dueDate: draft.dueDate ?? undefined,
              }}
              disabled={busy}
              onChange={(patch) =>
                update({
                  ...patch,
                  ...(Object.hasOwn(patch, "milestone")
                    ? { milestone: patch.milestone ?? null }
                    : {}),
                  ...(Object.hasOwn(patch, "dueDate") ? { dueDate: patch.dueDate ?? null } : {}),
                })
              }
              onRetry={options.retry}
            />
          </div>
          {error ? <RepositoryError error={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={busy || !draft.title.trim() || draft.body.length > 65000}
            >
              <Pencil className="size-4" />
              {t(busy ? "savingIssue" : "saveIssue")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
