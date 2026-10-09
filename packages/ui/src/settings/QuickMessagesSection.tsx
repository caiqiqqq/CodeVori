import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import type { QuickMessage } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { SettingsSearchInput } from "@/settings/SettingsSearchInput.js";
import { QuickMessageList } from "@/settings/QuickMessageList.js";
import { useQuickMessages } from "@/hooks/useQuickMessages.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function QuickMessagesSection() {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.quickMessages.${key}` });
  const { messages, loading, error, save, refresh } = useQuickMessages();
  const confirm = useConfirmDialog();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<QuickMessage | null>(null);
  const [original, setOriginal] = useState<QuickMessage | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const dirty = Boolean(
    draft && (draft.title !== original?.title || draft.content !== original?.content),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = messages.filter(
    (m) =>
      !normalizedQuery || `${m.title}\n${m.content}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const blocked = pending || loading || Boolean(error);
  const select = async (message: QuickMessage | null) => {
    if (blocked) return;
    if (
      dirty &&
      !(await confirm({
        title: t("discardTitle"),
        description: t("discardDescription"),
        confirmLabel: t("discard"),
        cancelLabel: t("cancel"),
      }))
    )
      return;
    setActionError(null);
    setDraft(message ? { ...message } : { id: nanoid(), title: "", content: "" });
    setOriginal(message);
  };
  const persist = async (next: QuickMessage[], after?: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setActionError(null);
    try {
      await save(next);
      after?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };
  const saveDraft = () => {
    if (!draft || !draft.title.trim() || !draft.content.trim()) return;
    const saved = { ...draft, title: draft.title.trim() };
    const next = original
      ? messages.map((m) => (m.id === saved.id ? saved : m))
      : [...messages, saved];
    void persist(next, () => {
      setDraft(saved);
      setOriginal(saved);
    });
  };
  const deleteDraft = async () => {
    if (!draft || !original || blocked) return;
    const id = draft.id;
    if (
      !(await confirm({
        title: t("deleteTitle"),
        description: t("deleteDescription"),
        confirmLabel: t("delete"),
        cancelLabel: t("cancel"),
        confirmVariant: "destructive",
      }))
    )
      return;
    await persist(
      messages.filter((m) => m.id !== id),
      () => {
        setDraft(null);
        setOriginal(null);
      },
    );
  };
  return (
    <section className="mt-3 min-w-0" data-testid="quick-messages-settings">
      <p className="mb-4 text-ui-caption text-foreground-subtle">{t("description")}</p>
      {error ? (
        <div role="alert" className="mb-3 flex items-center gap-2 text-ui-base text-destructive">
          {t("loadError")}
          <Button variant="outline" onClick={() => void refresh()}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="mb-3 text-ui-base text-destructive">
          {t("saveError")} {actionError}
        </p>
      ) : null}
      <div className="grid min-h-96 min-w-0 overflow-hidden rounded-xl border border-card-border bg-card md:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]">
        <div className="min-w-0 border-b border-card-border md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 border-b border-card-border p-3">
            <SettingsSearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              containerClassName="min-w-0 flex-1"
              onClear={() => setQuery("")}
              clearLabel={t("clearSearch")}
            />
            <Button
              size="lg"
              variant="secondary"
              disabled={blocked || messages.length >= 200}
              onClick={() => void select(null)}
            >
              <Plus className="size-4" />
              {t("new")}
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto md:max-h-[60vh]">
            <QuickMessageList
              messages={visible}
              selectedId={draft?.id}
              disabled={blocked}
              sortable={!normalizedQuery}
              onSelect={(message) => void select(message)}
              onReorder={(next) => void persist(next)}
            />
            {!visible.length ? (
              <p className="px-4 py-12 text-center text-ui-caption text-foreground-subtle">
                {loading ? t("loading") : normalizedQuery ? t("noResults") : t("empty")}
              </p>
            ) : null}
          </div>
        </div>
        {draft ? (
          <form
            className="flex min-w-0 flex-col gap-4 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveDraft();
            }}
          >
            <div className="flex flex-col gap-2 text-ui-base">
              <label htmlFor="quick-message-title">{t("messageTitle")}</label>
              <Input
                id="quick-message-title"
                size="lg"
                className="text-mobile-input-safe md:text-ui-base"
                value={draft.title}
                maxLength={100}
                disabled={blocked}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-2 text-ui-base">
              <label htmlFor="quick-message-content">{t("content")}</label>
              <Textarea
                id="quick-message-content"
                className="min-h-52 flex-1 resize-y border-input-border bg-input text-mobile-input-safe md:text-ui-base"
                value={draft.content}
                maxLength={20000}
                disabled={blocked}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              />
            </div>
            <p className="text-ui-caption text-foreground-subtle">{t("insertHint")}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {original ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="mr-auto text-destructive"
                  disabled={blocked}
                  onClick={() => void deleteDraft()}
                >
                  <Trash2 className="size-4" />
                  {t("delete")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  setDraft(original ? { ...original } : null);
                  setActionError(null);
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={blocked || !dirty || !draft.title.trim() || !draft.content.trim()}
              >
                {pending ? t("saving") : t("save")}
              </Button>
            </div>
          </form>
        ) : (
          <p className="flex min-h-52 items-center justify-center p-4 text-ui-caption text-foreground-subtle">
            {t("selectHint")}
          </p>
        )}
      </div>
    </section>
  );
}
