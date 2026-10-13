import { useState } from "react";
import { FolderGit2, FolderOpen, GitBranch, Link2, Loader2, Plus, X } from "lucide-react";
import type { LinkedRepository } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/index.js";

export interface LinkedRepositoriesController {
  repositories: LinkedRepository[];
  busy: boolean;
  error: string | null;
  branches: Record<string, string[]>;
  currentBranches: Record<string, string>;
  availableProjects: { path: string; name: string }[];
  add: (path: string) => Promise<boolean>;
  browse?: () => Promise<void>;
  change: (rows: LinkedRepository[]) => void;
  loadBranches: (path: string) => Promise<void>;
}

export function LinkedRepositoriesControl({
  workspacePath,
  controller,
  disabled = false,
}: {
  workspacePath: string;
  controller: LinkedRepositoriesController;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `chat.linkedProjects.${key}` });
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const locked = disabled || controller.busy;
  const rows = controller.repositories;
  const primaryName = workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? workspacePath;
  const update = (index: number, patch: Partial<LinkedRepository>) =>
    controller.change(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className="min-w-0 max-w-full" data-testid="linked-projects-control">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value)
            rows
              .filter((row) => !row.prepared)
              .forEach((row) => {
                void controller.loadBranches(row.sourcePath);
              });
        }}
      >
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={locked}
            data-testid="linked-projects-trigger"
            className="max-w-full text-foreground-subtle"
          >
            {controller.busy ? (
              <Loader2 className="size-3 animate-spin text-warning" />
            ) : (
              <Link2 className="size-3" />
            )}
            {controller.busy ? t("preparing") : t("trigger")}
            {rows.length > 0 ? (
              <span className="rounded bg-surface-hover px-1 text-ui-xs tabular-nums">
                {rows.length}
              </span>
            ) : null}
          </Button>
        </DialogTrigger>
        <DialogContent
          className="sm:max-w-lg max-h-[85dvh] overflow-y-auto"
          data-testid="linked-projects-dialog"
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <FolderGit2 className="size-4 shrink-0 text-foreground-subtle" />
                <span className="min-w-0 flex-1 truncate font-medium">{primaryName}</span>
                <span className="text-ui-sm text-foreground-subtle">{t("primary")}</span>
              </div>
              <p className="mt-1 break-all text-ui-sm text-foreground-subtle">{workspacePath}</p>
              <p className="mt-1 text-ui-sm text-foreground-subtle">{t("primaryHint")}</p>
            </div>
            {rows.map((row, index) => (
              <div
                key={row.sourcePath}
                className="rounded-lg border border-border p-3"
                data-testid="linked-project-row"
              >
                <div className="flex items-center gap-2">
                  <FolderGit2 className="size-4 shrink-0 text-foreground-subtle" />
                  <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={locked}
                    aria-label={intl.formatMessage(
                      { id: "chat.linkedProjects.remove" },
                      { name: row.name },
                    )}
                    onClick={() => controller.change(rows.filter((_, i) => i !== index))}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
                <p className="mt-1 break-all text-ui-sm text-foreground-subtle">{row.sourcePath}</p>
                {row.prepared ? (
                  <div className="mt-2 rounded-md bg-surface p-2">
                    <p className="flex items-center gap-1 text-ui-sm">
                      <GitBranch className="size-3" />
                      {row.prepared.branchName}
                    </p>
                    <p className="mt-1 text-ui-sm text-foreground-subtle">{t("executionPath")}</p>
                    <p
                      className="break-all select-text text-ui-sm font-mono"
                      data-testid="linked-project-execution-path"
                    >
                      {row.prepared.executionPath}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ui-sm text-foreground-subtle">{t("baseBranch")}</span>
                      <Select
                        value={row.baseBranch}
                        disabled={locked || !row.useWorktree}
                        onValueChange={(baseBranch) => update(index, { baseBranch })}
                      >
                        <SelectTrigger
                          size="sm"
                          className="max-w-full"
                          aria-label={intl.formatMessage(
                            { id: "chat.linkedProjects.branchLabel" },
                            { name: row.name },
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from(
                            new Set([
                              row.baseBranch,
                              ...(controller.branches[row.sourcePath] ?? []),
                            ]),
                          ).map((branch) => (
                            <SelectItem key={branch} value={branch}>
                              {branch}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-ui-sm">
                      <Checkbox
                        checked={row.useWorktree}
                        disabled={locked}
                        onCheckedChange={(checked) =>
                          update(index, {
                            useWorktree: checked === true,
                            ...(checked !== true && controller.currentBranches[row.sourcePath]
                              ? { baseBranch: controller.currentBranches[row.sourcePath] }
                              : {}),
                          })
                        }
                      />
                      {t("useWorktree")}
                    </label>
                    <p className="text-ui-sm text-foreground-subtle">
                      {t(row.useWorktree ? "worktreeHint" : "directHint")}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
          {controller.error ? (
            <p role="alert" className="break-words text-ui-sm text-destructive">
              {controller.error}
            </p>
          ) : null}
          {rows.length < 8 ? (
            <div className="space-y-2 border-t border-border pt-3">
              {controller.availableProjects.length ? (
                <Select
                  value=""
                  disabled={locked}
                  onValueChange={(value) => {
                    void controller.add(value);
                  }}
                >
                  <SelectTrigger className="w-full" aria-label={t("chooseOpen")}>
                    <SelectValue placeholder={t("chooseOpen")} />
                  </SelectTrigger>
                  <SelectContent>
                    {controller.availableProjects.map((project) => (
                      <SelectItem key={project.path} value={project.path}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <form
                className="flex min-w-0 items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (path.trim())
                    void controller.add(path).then((added) => {
                      if (added) setPath("");
                    });
                }}
              >
                <Input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  disabled={locked}
                  placeholder={t("pathPlaceholder")}
                  aria-label={t("pathLabel")}
                  className="min-w-0 flex-1"
                />
                {controller.browse ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={locked}
                    aria-label={t("browse")}
                    onClick={() => {
                      void controller.browse?.();
                    }}
                  >
                    <FolderOpen className="size-4" />
                  </Button>
                ) : null}
                <Button type="submit" variant="outline" disabled={locked || !path.trim()}>
                  <Plus className="size-3" />
                  {t("add")}
                </Button>
              </form>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" disabled={locked} onClick={() => setOpen(false)}>
              {t("done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!open && controller.error ? (
        <p role="alert" className="px-2 py-1 text-ui-sm text-destructive">
          {controller.error}
        </p>
      ) : null}
    </div>
  );
}
