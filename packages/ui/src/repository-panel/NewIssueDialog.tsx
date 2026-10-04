import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { RepositoryError, useRepositoryMessages } from "./RepositoryParts.js";

export function NewIssueDialog({
  open,
  repositoryName,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  repositoryName: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (title: string, body: string) => Promise<void>;
}) {
  const t = useRepositoryMessages();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{t("newIssue")}</DialogTitle>
        <DialogDescription className="break-all text-ui-sm">{repositoryName}</DialogDescription>
        <form
          data-testid="repository-new-issue"
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && title.trim()) void onSubmit(title.trim(), body);
          }}
        >
          <label className="flex flex-col gap-1.5 text-ui-sm">
            {t("titleField")}
            <Input
              size="lg"
              autoFocus
              required
              maxLength={256}
              value={title}
              disabled={busy}
              className="text-mobile-input-safe md:text-ui-base"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-ui-sm">
            {t("description")}
            <Textarea
              rows={8}
              maxLength={65000}
              value={body}
              disabled={busy}
              className="field-sizing-fixed resize-y text-mobile-input-safe md:text-ui-base"
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          {error ? <RepositoryError error={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              <Plus className="size-4" />
              {t(busy ? "creating" : "create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
