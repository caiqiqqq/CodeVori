import { useRef, type RefObject } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";

export function WorkspaceRenameDialog({
  open,
  value,
  inputRef,
  intl,
  saving,
  onOpenChange,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  intl: {
    formatMessage: (desc: { id: string }, values?: Record<string, string>) => string;
  };
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const compositionActiveRef = useRef(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-xl overflow-hidden rounded-2xl p-0">
        <div className="flex min-w-0 flex-col gap-6 p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle>{intl.formatMessage({ id: "workspaceSidebar.rename" })}</DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: "workspaceSidebar.renameDescription" })}
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={inputRef}
            value={value}
            disabled={saving}
            aria-label={intl.formatMessage({ id: "workspaceSidebar.rename" })}
            size="lg"
            className="text-mobile-input-safe md:text-ui-base"
            placeholder={intl.formatMessage({ id: "workspaceSidebar.renamePlaceholder" })}
            onChange={(event) => onChange(event.target.value)}
            onCompositionEnd={() => {
              compositionActiveRef.current = false;
            }}
            onCompositionStart={() => {
              compositionActiveRef.current = true;
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              if (
                isImeComposingKeyEvent({
                  compositionActive: compositionActiveRef.current,
                  nativeEvent: event.nativeEvent,
                })
              ) {
                return;
              }
              event.preventDefault();
              onConfirm();
            }}
          />
          <DialogFooter className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={saving}
              onClick={onCancel}
            >
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="button" size="lg" disabled={saving} onClick={onConfirm}>
              {intl.formatMessage({ id: "common.confirm" })}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
