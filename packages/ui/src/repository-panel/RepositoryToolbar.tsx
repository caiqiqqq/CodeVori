import { useState } from "react";
import { ListFilter, Search, X } from "lucide-react";
import type { ForgeItemKind, ForgeLabel, ForgeProvider, ForgeSort } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { RepositoryIconButton, useRepositoryMessages } from "./RepositoryParts.js";

export interface RepositoryFilters {
  kind: ForgeItemKind;
  state: "open" | "closed" | "all";
  search: string;
  sort: ForgeSort;
  labels: string[];
  page: number;
}

export function RepositoryToolbar({
  provider,
  filters,
  labels,
  onChange,
}: {
  provider: ForgeProvider;
  filters: RepositoryFilters;
  labels: ForgeLabel[];
  onChange: (patch: Partial<RepositoryFilters>) => void;
}) {
  const t = useRepositoryMessages();
  const [searchDraft, setSearchDraft] = useState(filters.search);
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-3">
      <Tabs
        value={filters.kind}
        onValueChange={(kind) => onChange({ kind: kind as ForgeItemKind })}
      >
        <TabsList variant="line">
          <TabsTrigger value="issue">{t("issues")}</TabsTrigger>
          <TabsTrigger value="pull-request">
            {t(provider === "gitlab" ? "mergeRequests" : "pullRequests")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex w-full min-w-0 items-center gap-1 sm:w-auto sm:flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            onChange({ search: searchDraft.trim() });
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="absolute left-2 top-2 size-4 text-foreground-subtle"
            />
            <Input
              size="lg"
              className="pl-8 text-mobile-input-safe md:text-ui-base"
              aria-label={t("search")}
              placeholder={t("search")}
              value={searchDraft}
              maxLength={512}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
          <RepositoryIconButton label={t("searchAction")} type="submit">
            <Search className="size-4" />
          </RepositoryIconButton>
          {searchDraft || filters.search ? (
            <RepositoryIconButton
              label={t("clearSearch")}
              onClick={() => {
                setSearchDraft("");
                onChange({ search: "" });
              }}
            >
              <X className="size-4" />
            </RepositoryIconButton>
          ) : null}
        </form>
        <Select
          value={filters.state}
          onValueChange={(state) => onChange({ state: state as RepositoryFilters["state"] })}
        >
          <SelectTrigger size="lg" aria-label={t("stateFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["open", "closed", "all"] as const).map((state) => (
              <SelectItem key={state} value={state}>
                {t(`state.${state}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg" aria-label={t("labels")}>
              <ListFilter className="size-4" />
              {t("labels")}
              {filters.labels.length ? (
                <span className="text-ui-xs">{filters.labels.length}</span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 max-w-72 overflow-y-auto">
            {labels.length ? (
              labels.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label.key}
                  checked={filters.labels.includes(label.key)}
                  disabled={!filters.labels.includes(label.key) && filters.labels.length >= 20}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    onChange({
                      labels: checked
                        ? [...filters.labels, label.key]
                        : filters.labels.filter((key) => key !== label.key),
                    })
                  }
                >
                  {label.name}
                </DropdownMenuCheckboxItem>
              ))
            ) : (
              <DropdownMenuItem disabled>{t("noLabels")}</DropdownMenuItem>
            )}
            {filters.labels.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onChange({ labels: [] })}>
                  {t("clearLabels")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {provider !== "gitea" ? (
          <Select
            value={filters.sort}
            onValueChange={(sort) => onChange({ sort: sort as ForgeSort })}
          >
            <SelectTrigger size="lg" aria-label={t("sort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["newest", "oldest", "updated"] as const).map((sort) => (
                <SelectItem key={sort} value={sort}>
                  {t(`sort.${sort}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}
