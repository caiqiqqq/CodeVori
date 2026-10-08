import type { DelegationTask } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { delegationErrorMessage } from "./delegationMessages.js";

export function DelegationAttemptResult({
  attempt,
  busy,
  redeliver,
}: {
  attempt: DelegationTask["attempts"][number];
  busy: boolean;
  redeliver(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `delegation.${key}` });
  const result = attempt.result;
  return (
    <details className="mt-1 min-w-0" data-testid="delegation-attempt">
      <summary className="cursor-pointer text-foreground-subtle">
        {intl.formatMessage({ id: "delegation.attempt" }, { number: attempt.sequence })} ·{" "}
        {t(attempt.status)}
        {attempt.delivery ? (
          <span className="ml-2 text-ui-xs">{t(`delivery.${attempt.delivery}`)}</span>
        ) : null}
      </summary>
      {attempt.error ? (
        <p className="mt-2 break-words text-destructive">
          {delegationErrorMessage(attempt.error, intl)}
        </p>
      ) : null}
      {attempt.delivery === "uncertain" ? (
        <ControlHintTooltip title={t("redeliver")}>
          <Button
            aria-label={t("redeliver")}
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={busy}
            onClick={redeliver}
          >
            <Send className="size-3.5" />
          </Button>
        </ControlHintTooltip>
      ) : null}
      {result ? (
        <div className="mt-2 min-w-0 overflow-x-auto">
          {!result.structured ? (
            <p className="mb-1 text-ui-xs text-foreground-subtle">{t("unstructured")}</p>
          ) : null}
          <MessageResponse>{result.conclusion}</MessageResponse>
          {(["changedFiles", "tests", "risks", "blockers"] as const).map((key) =>
            result[key].length ? (
              <div key={key} className="mt-2">
                <span className="text-foreground-subtle">{t(key)}</span>
                <ul className="list-inside list-disc break-words">
                  {result[key].map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      ) : null}
    </details>
  );
}
