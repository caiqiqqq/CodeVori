import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function ImageZoomControls({
  scale,
  saving,
  zoom,
}: {
  scale: number;
  saving: boolean;
  zoom: (scale: number) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-popover-border bg-popover p-1 shadow-md">
      <Button
        aria-label={intl.formatMessage({ id: "markdownImage.zoomOut" })}
        disabled={saving || scale <= 0.5}
        onClick={() => zoom(scale - 0.5)}
        size="icon-sm"
        variant="ghost"
        className="rounded-full"
      >
        <MinusIcon />
      </Button>
      <span className="min-w-12 text-center text-ui-base">{Math.round(scale * 100)}%</span>
      <Button
        aria-label={intl.formatMessage({ id: "markdownImage.zoomIn" })}
        disabled={saving || scale >= 3}
        onClick={() => zoom(scale + 0.5)}
        size="icon-sm"
        variant="ghost"
        className="rounded-full"
      >
        <PlusIcon />
      </Button>
    </div>
  );
}
