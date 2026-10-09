import { useRef, useState } from "react";
import {
  validateAcpElicitationContent,
  type AcpElicitation,
  type AcpElicitationResponse,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

type Draft = Record<string, string | boolean | string[]>;

/** 仅保存未提交草稿；父组件按 session/request key 重挂载，Host 是唯一等待态所有者。 */
export function AcpElicitationForm({
  request,
  busy,
  onRespond,
}: {
  request: AcpElicitation;
  busy: boolean;
  onRespond: (requestId: string, response: AcpElicitationResponse) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `acp.input.${key}` });
  const [draft, setDraft] = useState<Draft>({});
  const submitting = useRef(false);
  const content = Object.fromEntries(
    request.fields.flatMap((field) => {
      const value = Object.hasOwn(draft, field.key) ? draft[field.key] : undefined;
      if (value === undefined || value === "") return [];
      return [
        [field.key, field.type === "number" || field.type === "integer" ? Number(value) : value],
      ];
    }),
  );
  const valid = validateAcpElicitationContent(request.fields, content);
  const respond = async (response: AcpElicitationResponse) => {
    if (busy || submitting.current) return;
    submitting.current = true;
    try {
      await onRespond(request.requestId, response);
    } finally {
      submitting.current = false;
    }
  };
  return (
    <form
      data-testid="acp-elicitation"
      className="space-y-3 rounded-xl border border-border bg-interaction-confirmation-surface p-3 text-ui-base"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void respond({ action: "accept", content });
      }}
    >
      <p className="whitespace-pre-wrap break-words text-foreground">{request.message}</p>
      {request.fields.map((field, index) => {
        const inputId = `acp-input-${request.requestId}-${index}`;
        const options =
          field.type === "boolean"
            ? [
                { value: "true", label: t("yes") },
                { value: "false", label: t("no") },
              ]
            : field.choices;
        const value = Object.hasOwn(draft, field.key) ? draft[field.key] : undefined;
        return (
          <fieldset key={field.key} disabled={busy} className="min-w-0 space-y-1">
            <legend className="break-words text-foreground">
              {field.title}
              {field.required ? " *" : ""}
            </legend>
            {field.description ? (
              <p className="whitespace-pre-wrap break-words text-ui-caption text-foreground-subtle">
                {field.description}
              </p>
            ) : null}
            {options.length ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={field.title}>
                {options.map((option) => {
                  const selected = Array.isArray(value)
                    ? value.includes(option.value)
                    : value !== undefined && String(value) === option.value;
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={selected ? "secondary" : "outline"}
                      aria-pressed={selected}
                      title={"description" in option ? option.description : undefined}
                      onClick={() =>
                        setDraft((previous) => {
                          const previousValue = previous[field.key];
                          const values = Array.isArray(previousValue) ? previousValue : [];
                          return {
                            ...previous,
                            [field.key]:
                              field.type === "boolean"
                                ? option.value === "true"
                                : field.type === "array"
                                  ? values.includes(option.value)
                                    ? values.filter((item) => item !== option.value)
                                    : [...values, option.value]
                                  : option.value,
                          };
                        })
                      }
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <Input
                className="text-mobile-input-safe md:text-ui-base"
                id={inputId}
                aria-label={field.title}
                name={field.key}
                autoComplete="off"
                type={
                  field.sensitive
                    ? "password"
                    : field.type === "number" || field.type === "integer"
                      ? "number"
                      : "text"
                }
                step={field.type === "integer" ? 1 : "any"}
                min={field.minimum}
                max={field.maximum}
                minLength={field.minLength}
                maxLength={field.maxLength}
                required={field.required}
                value={typeof value === "string" ? value : ""}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))
                }
              />
            )}
          </fieldset>
        );
      })}
      {!valid && Object.keys(draft).length > 0 ? (
        <p className="text-ui-caption text-foreground-subtle" role="status">
          {t("checkAnswers")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !valid}>
          {t("submit")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void respond({ action: "decline" })}
        >
          {t("decline")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void respond({ action: "cancel" })}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
