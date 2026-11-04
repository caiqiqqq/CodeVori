import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { Annotation } from "./geometry.js";

export function ImageTextDraft({
  draft,
  saving,
  onChange,
  onApply,
  onCancel,
}: {
  draft: Annotation;
  saving: boolean;
  onChange: (draft: Annotation) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div
      className="absolute left-1/2 top-20 z-30 flex max-w-full -translate-x-1/2 gap-1 rounded-xl border border-popover-border bg-popover p-2"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Input
        autoFocus
        aria-label={intl.formatMessage({ id: "imageEditor.textValue" })}
        value={draft.text}
        disabled={saving}
        className="w-48 text-mobile-input-safe sm:text-ui-base"
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onApply();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button disabled={saving} onClick={onApply}>
        {intl.formatMessage({ id: "imageEditor.applyText" })}
      </Button>
    </div>
  );
}
