import { useRef } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import type { useForgeImageUploads } from "@/hooks/useForgeImageUploads.js";
import { RepositoryError, useRepositoryMessages } from "./RepositoryParts.js";

export function NewIssueImages({
  uploads,
  disabled,
  onRemove,
  onOpenRepository,
}: {
  uploads: ReturnType<typeof useForgeImageUploads>;
  disabled: boolean;
  onRemove: (id: string) => void;
  onOpenRepository: () => void;
}) {
  const t = useRepositoryMessages();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div data-testid="repository-issue-images" className="flex min-w-0 flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        disabled={disabled || !uploads.capability?.supported}
        aria-label={t("addImages")}
        onChange={(event) => {
          uploads.add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !uploads.capability?.supported}
          onClick={() => input.current?.click()}
        >
          <ImagePlus className="size-4" />
          {t("addImages")}
        </Button>
        {!uploads.capability || uploads.capability.supported ? (
          <span className="text-ui-xs text-foreground-subtle">
            {t(
              !uploads.capability
                ? "loading"
                : uploads.capability.requiresWebLogin
                  ? "imageWebLoginHint"
                  : "imageUploadHint",
            )}
          </span>
        ) : null}
      </div>
      {uploads.capability && !uploads.capability.supported ? (
        <div className="flex flex-wrap items-center gap-2 text-ui-sm text-foreground-subtle">
          <span>
            {t(
              uploads.capability.reason === "web-login-unavailable"
                ? "imageWebUnavailable"
                : "imageProviderUnsupported",
            )}
          </span>
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={disabled}
            onClick={onOpenRepository}
          >
            {t("openRepositoryWeb")}
          </Button>
        </div>
      ) : null}
      {uploads.error ? (
        <RepositoryError
          error={uploads.error}
          retry={!uploads.capability ? uploads.retryCapability : undefined}
        />
      ) : null}
      {uploads.images.map((image) => (
        <div
          key={image.id}
          data-testid="repository-draft-image"
          className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface p-2"
        >
          <img
            src={image.preview}
            alt={image.file.name}
            className="size-12 shrink-0 rounded-md object-contain"
          />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-ui-sm">{image.file.name}</span>
            {image.state === "failed" ? (
              <RepositoryError
                error={image.error ?? "RESPONSE"}
                retry={disabled ? undefined : () => uploads.retry(image.id)}
              />
            ) : (
              <span
                role="status"
                className="flex items-center gap-1 text-ui-xs text-foreground-subtle"
              >
                {image.state === "uploading" ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : null}
                {t(image.state === "uploading" ? "imageUploading" : "imageUploaded")}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("removeImage", { name: image.file.name })}
            disabled={disabled}
            onClick={() => onRemove(image.id)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
