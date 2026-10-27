import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import type { EmbeddedBrowserSitePermissionPrompt as PromptEvent } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const LABELS: Record<string, string> = {
  usb: "browser.sitePermission.usb",
  hid: "browser.sitePermission.hid",
  serial: "browser.sitePermission.serial",
  bluetooth: "browser.sitePermission.bluetooth",
  display: "browser.sitePermission.display",
  media: "browser.sitePermission.media",
  "media:audio": "browser.sitePermission.microphone",
  "media:video": "browser.sitePermission.camera",
  "clipboard-read": "browser.sitePermission.clipboard",
  geolocation: "browser.sitePermission.location",
  notifications: "browser.sitePermission.notifications",
  midi: "browser.sitePermission.midi",
  midiSysex: "browser.sitePermission.midi",
  "idle-detection": "browser.sitePermission.idle",
  "speaker-selection": "browser.sitePermission.speaker",
  "window-management": "browser.sitePermission.windows",
  "storage-access": "browser.sitePermission.storage",
  "top-level-storage-access": "browser.sitePermission.storage",
  keyboardLock: "browser.sitePermission.keyboard",
  fileSystem: "browser.sitePermission.files",
};

export function sitePermissionLabel(permission: string): string {
  return LABELS[permission] ?? "browser.sitePermission.other";
}

export function EmbeddedBrowserSitePermissionPrompt({
  guestWebContentsId,
}: {
  guestWebContentsId: number;
}) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const [prompts, setPrompts] = useState<PromptEvent[]>([]);

  useEffect(() => {
    if (guestWebContentsId <= 0) return;
    return platform.onEmbeddedBrowserSitePermissionPrompt?.((event) => {
      if (event.guestWebContentsId !== guestWebContentsId) return;
      setPrompts((current) =>
        current.some((item) => item.requestId === event.requestId)
          ? current.map((item) => (item.requestId === event.requestId ? event : item))
          : [...current, event],
      );
    });
  }, [guestWebContentsId, platform]);

  useEffect(
    () =>
      platform.onEmbeddedBrowserSitePermissionClosed?.((requestId) => {
        setPrompts((current) => current.filter((item) => item.requestId !== requestId));
      }),
    [platform],
  );

  useEffect(() => {
    if (!prompts.length) return;
    // 使用 Main 给出的截止时间，新增请求不能延长旧弹窗的可见时间。
    const timer = setTimeout(
      () => setPrompts((current) => current.filter((item) => item.expiresAt > Date.now())),
      Math.max(0, Math.min(...prompts.map((item) => item.expiresAt)) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [prompts]);

  const resolve = (
    requestId: string,
    action: "allow-always" | "allow-session" | "dismiss" | "select",
    selectionId?: string,
  ) => {
    platform.resolveEmbeddedBrowserSitePermissionPrompt?.({ requestId, action, selectionId });
    setPrompts((current) => current.filter((item) => item.requestId !== requestId));
  };

  if (!prompts.length) return null;
  return (
    <div
      className="pointer-events-none absolute left-3 top-12 z-40 flex w-80 max-w-[calc(100%-24px)] flex-col gap-2"
      data-testid="browser-site-permission-prompts"
    >
      {prompts.map((prompt) => (
        <div
          key={prompt.requestId}
          role="dialog"
          aria-label={intl.formatMessage({ id: "browser.sitePermission.request" })}
          className="pointer-events-auto rounded-md border border-popover-border bg-popover p-4 shadow-md"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="break-all text-ui-base font-medium text-foreground">{prompt.origin}</p>
              <p className="text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: sitePermissionLabel(prompt.permission) })}
              </p>
              {prompt.permission === "media" && prompt.mediaTypes?.length ? (
                <p className="text-ui-caption text-foreground-subtle">
                  {prompt.mediaTypes
                    .map((type) => intl.formatMessage({ id: sitePermissionLabel(`media:${type}`) }))
                    .join(", ")}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={intl.formatMessage({ id: "common.close" })}
              onClick={() => resolve(prompt.requestId, "dismiss")}
            >
              <X className="size-4" />
            </Button>
          </div>
          {prompt.choices ? (
            <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto">
              {prompt.choices.length === 0 ? (
                <p className="text-ui-caption text-foreground-subtle">
                  {intl.formatMessage({ id: "browser.sitePermission.noDevices" })}
                </p>
              ) : (
                prompt.choices.map((choice) => (
                  <Button
                    key={choice.id}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal py-2 text-left"
                    onClick={() => resolve(prompt.requestId, "select", choice.id)}
                  >
                    {choice.thumbnailDataUrl ? (
                      <img
                        className="mr-2 w-20 shrink-0 rounded-sm"
                        src={choice.thumbnailDataUrl}
                        alt=""
                      />
                    ) : null}
                    <span className="min-w-0 break-all">{choice.name}</span>
                  </Button>
                ))
              )}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => resolve(prompt.requestId, "dismiss")}
            >
              {intl.formatMessage({ id: "browser.sitePermission.deny" })}
            </Button>
            {!prompt.choices ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => resolve(prompt.requestId, "allow-session")}
                >
                  {intl.formatMessage({ id: "browser.sitePermission.allowSession" })}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => resolve(prompt.requestId, "allow-always")}
                >
                  {intl.formatMessage({ id: "browser.sitePermission.allowAlways" })}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
