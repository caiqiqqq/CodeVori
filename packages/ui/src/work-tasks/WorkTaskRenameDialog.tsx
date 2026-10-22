import { useRef, useState } from "react";
import type { WorkTask } from "@zcode/shared";
import type { WorkTaskPanel } from "@/hooks/useWorkTasks.js";
import { useWorkTaskEditorSave } from "@/hooks/useWorkTaskEditorSave.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { WorkTaskError, useWorkTaskMessages } from "./WorkTaskParts.js";

export function WorkTaskRenameDialog({
  task,
  panel,
  onClose,
}: {
  task: WorkTask;
  panel: WorkTaskPanel;
  onClose(): void;
}) {
  const { intl } = useZCodeIntl();
  const t = useWorkTaskMessages();
  const [value, setValue] = useState(task.title);
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const submission = useWorkTaskEditorSave(panel.busy);
  const title = value.trim();
  const valid = title.length > 0 && title.length <= 200;
  const close = () => {
    if (!submission.busy) onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-w-md"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.select();
        }}
      >
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            void submission.submit(async (signal) => {
              setError(null);
              const saved = await panel.rename(task.id, title, setError);
              if (saved && !signal.aborted) onClose();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{intl.formatMessage({ id: "taskList.rename" })}</DialogTitle>
          </DialogHeader>
          <Input
            ref={input}
            aria-label={intl.formatMessage({ id: "taskList.renamePlaceholder" })}
            value={value}
            disabled={submission.busy}
            onChange={(event) => setValue(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              // 中文候选的 Enter 只确认输入法，不能触发原生 form 提交。
              if (
                event.key === "Enter" &&
                isImeComposingKeyEvent({
                  compositionActive: composing.current,
                  nativeEvent: event.nativeEvent,
                })
              )
                event.preventDefault();
            }}
          />
          <WorkTaskError error={error ?? submission.error} />
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={submission.busy} onClick={close}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="submit" disabled={!valid || submission.busy}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
