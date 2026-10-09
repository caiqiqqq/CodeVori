import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  ForgeIssueDraft,
  ForgeIssueOptions,
  ForgeIssueOptionSection,
  ForgeProvider,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { RepositoryError, RepositoryLabels, useRepositoryMessages } from "./RepositoryParts.js";

function IssueMultiSelect({
  title,
  section,
  selected,
  disabled,
  limit = 20,
  labelColors = false,
  onChange,
}: {
  title: string;
  section?: ForgeIssueOptionSection<{ key: string; name: string; color?: string | null }>;
  selected: string[];
  disabled: boolean;
  limit?: number;
  labelColors?: boolean;
  onChange: (keys: string[]) => void;
}) {
  const t = useRepositoryMessages();
  const [search, setSearch] = useState("");
  const items = section?.items ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-ui-sm">
      <span>{title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between"
            disabled={disabled || !section || Boolean(section.error) || !items.length}
            aria-label={title}
          >
            <span className="truncate">
              {selected.length
                ? items
                    .filter((item) => selected.includes(item.key))
                    .map((item) => item.name)
                    .join(", ") || t("selectedCount", { count: selected.length })
                : t("selectOptions", { field: title })}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64 max-w-[calc(100vw-2rem)]" align="start">
          <Input
            aria-label={t("searchOptions", { field: title })}
            placeholder={t("searchOptions", { field: title })}
            value={search}
            className="mb-1 text-mobile-input-safe md:text-ui-base"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
            }}
          />
          <div className="max-h-56 overflow-y-auto">
            {items
              .filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
              .map((item) => (
                <DropdownMenuCheckboxItem
                  key={item.key}
                  checked={selected.includes(item.key)}
                  disabled={disabled || (!selected.includes(item.key) && selected.length >= limit)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...selected, item.key]
                        : selected.filter((key) => key !== item.key),
                    )
                  }
                >
                  {labelColors ? (
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full bg-foreground-subtlest"
                      style={item.color ? { backgroundColor: item.color } : undefined}
                    />
                  ) : null}
                  <span className="break-all">{item.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {labelColors && selected.length ? (
        <div data-testid="repository-selected-labels">
          <RepositoryLabels
            labels={items
              .filter((item) => selected.includes(item.key))
              .map((item) => ({ ...item, color: item.color ?? null }))}
          />
        </div>
      ) : null}
      {section?.error ? (
        <RepositoryError error={section.error} />
      ) : section && !items.length ? (
        <span className="text-foreground-subtle">{t("noOptions")}</span>
      ) : null}
    </div>
  );
}

export function NewIssueAttributes({
  provider,
  options,
  loading,
  error,
  draft,
  disabled,
  onChange,
  onRetry,
}: {
  provider: ForgeProvider;
  options: ForgeIssueOptions | null;
  loading: boolean;
  error: string | null;
  draft: ForgeIssueDraft;
  disabled: boolean;
  onChange: (patch: Partial<ForgeIssueDraft>) => void;
  onRetry: () => void;
}) {
  const t = useRepositoryMessages();
  const unavailable = disabled || loading || Boolean(error);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="repository-issue-attributes">
      {loading ? (
        <span role="status" className="text-ui-sm text-foreground-subtle">
          {t("loadingOptions")}
        </span>
      ) : null}
      {error ? <RepositoryError error={error} /> : null}
      <IssueMultiSelect
        title={t("labels")}
        section={options?.labels}
        selected={draft.labels ?? []}
        labelColors
        disabled={unavailable}
        onChange={(labels) => onChange({ labels })}
      />
      <IssueMultiSelect
        title={t("assignees")}
        section={
          options
            ? {
                ...options.assignees,
                items: options.assignees.items.map((user) => ({
                  key: user.key,
                  name: user.displayName
                    ? `${user.displayName} (@${user.username})`
                    : user.username,
                })),
              }
            : undefined
        }
        selected={draft.assignees ?? []}
        limit={provider === "github" ? 10 : 20}
        disabled={unavailable}
        onChange={(assignees) => onChange({ assignees })}
      />
      <div className="flex min-w-0 flex-col gap-1.5 text-ui-sm">
        <span>{t("milestone")}</span>
        <Select
          value={draft.milestone ?? "none"}
          onValueChange={(value) => onChange({ milestone: value === "none" ? undefined : value })}
        >
          <SelectTrigger
            aria-label={t("milestone")}
            disabled={
              unavailable ||
              !options ||
              Boolean(options.milestones.error) ||
              !options.milestones.items.length
            }
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("noSelection")}</SelectItem>
            {options?.milestones.items.map((milestone) => (
              <SelectItem key={milestone.key} value={milestone.key}>
                {milestone.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options?.milestones.error ? (
          <RepositoryError error={options.milestones.error} />
        ) : options && !options.milestones.items.length ? (
          <span className="text-foreground-subtle">{t("noOptions")}</span>
        ) : null}
      </div>
      {provider === "gitlab" ? (
        <>
          <label className="flex flex-col gap-1.5 text-ui-sm">
            {t("dueDate")}
            <Input
              type="date"
              max="9999-12-31"
              value={draft.dueDate ?? ""}
              disabled={disabled}
              className="text-mobile-input-safe md:text-ui-base"
              onChange={(event) => onChange({ dueDate: event.target.value || undefined })}
            />
          </label>
          <label className="flex items-center gap-2 text-ui-sm">
            <Checkbox
              checked={draft.confidential ?? false}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ confidential: checked === true })}
            />
            {t("confidential")}
          </label>
        </>
      ) : null}
      {error || (options && Object.values(options).some((section) => section.error)) ? (
        <Button type="button" variant="outline" disabled={disabled || loading} onClick={onRetry}>
          {t("retryOptions")}
        </Button>
      ) : null}
    </div>
  );
}
