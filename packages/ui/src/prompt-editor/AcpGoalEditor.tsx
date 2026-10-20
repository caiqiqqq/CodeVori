import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function AcpGoalEditor({
  initialGoal,
  onSave,
  onCancel,
  onSaved,
}: {
  initialGoal?: string | null;
  onSave?: (goal: string | null) => Promise<void>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [draft, setDraft] = useState(initialGoal ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => textareaRef.current?.focus(), []);

  const save = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    try {
      await onSave(draft.trim() || null);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="text-ui-base font-medium" htmlFor="acp-session-goal">
        {intl.formatMessage({ id: "acp.goal" })}
      </label>
      <textarea
        ref={textareaRef}
        id="acp-session-goal"
        className="min-h-24 rounded-md border border-input-border bg-input p-2 text-ui-base text-foreground"
        maxLength={4000}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          {intl.formatMessage({ id: "acp.goalCancel" })}
        </Button>
        <Button type="button" disabled={saving || !onSave} onClick={() => void save()}>
          {intl.formatMessage({ id: "acp.goalSave" })}
        </Button>
      </div>
    </div>
  );
}
