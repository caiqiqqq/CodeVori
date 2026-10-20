import { RefreshCw, Star } from "lucide-react";
import type { AcpAgentModel } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";

/** Shared list interaction; source ownership and saving remain with each editor. */
export function AcpModelPicker({
  id,
  value,
  models,
  loading,
  error,
  disabled,
  readOnly,
  labels,
  onChange,
  onRefresh,
}: {
  id: string;
  value: string;
  models: AcpAgentModel[];
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  labels: {
    title: string;
    refresh: string;
    loading: string;
    placeholder: string;
    hint: string;
    empty?: string;
  };
  onChange: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-ui-sm text-foreground-subtle">
          {labels.title}
        </label>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={labels.refresh}
          onClick={onRefresh}
          disabled={loading || disabled}
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {loading ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {labels.loading}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={labels.placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {models.length ? (
        <div
          className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1.5"
          aria-label={labels.title}
        >
          {models.map((item) => (
            <button
              key={item.slug}
              type="button"
              aria-pressed={value === item.slug}
              disabled={disabled || readOnly}
              onClick={() => onChange(item.slug)}
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
            >
              <Star
                className={`size-4 shrink-0 ${value === item.slug ? "fill-warning text-warning" : "text-foreground-subtlest"}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="max-w-[45%] truncate font-mono text-ui-xs text-foreground-subtle">
                {item.slug}
              </span>
            </button>
          ))}
        </div>
      ) : !loading && !error && labels.empty ? (
        <p className="text-ui-sm text-foreground-subtle">{labels.empty}</p>
      ) : null}
      <p className="text-ui-sm text-foreground-subtle">{labels.hint}</p>
    </div>
  );
}
