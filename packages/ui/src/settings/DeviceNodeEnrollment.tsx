import { useState } from "react";
import { Plus, Download } from "lucide-react";
import type { DeviceNodeCommand, DeviceNodePlatform, DeviceNodeView } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { SettingsGroupCard } from "./SettingsPageParts.js";

const targets: [DeviceNodePlatform, string][] = [
  ["win32-x64", "Windows · x64"],
  ["win32-arm64", "Windows · ARM64"],
  ["darwin-arm64", "macOS · Apple Silicon"],
  ["darwin-x64", "macOS · Intel"],
  ["linux-x64", "Linux · x64"],
  ["linux-arm64", "Linux · ARM64"],
];
export function DeviceNodeEnrollment({
  nodes,
  busy,
  run,
}: {
  nodes: DeviceNodeView[];
  busy: boolean;
  run(command: DeviceNodeCommand): Promise<void>;
}) {
  const platformService = usePlatform();
  const { intl } = useZCodeIntl();
  const confirm = useConfirmDialog();
  const [platform, setPlatform] = useState<DeviceNodePlatform>("win32-x64");
  const t = (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `settings.devices.node.${key}` }, values);
  return (
    <SettingsGroupCard>
      <div className="space-y-3 p-4" data-testid="device-node-enrollment">
        <div className="space-y-1">
          <h3 className="text-ui-base font-medium">{t("title")}</h3>
          <p className="text-ui-sm leading-5 text-foreground-subtle">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={platform}
            onValueChange={(value) => setPlatform(value as DeviceNodePlatform)}
          >
            <SelectTrigger
              className="w-56 max-w-full"
              aria-label={t("platform")}
              data-testid="device-node-platform"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={busy}
            onClick={() => void run({ action: "node-create", platform })}
            data-testid="device-node-create"
          >
            <Plus className="size-4" />
            {t("add")}
          </Button>
        </div>
      </div>
      {nodes.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {nodes.map((node) => (
            <li
              key={node.id}
              className="min-w-0 space-y-3 p-4"
              data-testid={`device-node-${node.id}`}
            >
              <div className="space-y-1">
                <p className="text-ui-base font-medium">
                  {targets.find(([key]) => key === node.platform)?.[1]}
                </p>
                <p className="text-ui-sm text-foreground-subtle" data-testid="device-node-status">
                  {t(node.status, { count: node.toolCount ?? 0 })}
                </p>
              </div>
              {node.installationUrl ? (
                <div className="space-y-2">
                  <p className="text-ui-sm text-foreground-subtle">{t("share")}</p>
                  <Input
                    readOnly
                    value={node.installationUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label={t("link")}
                    data-testid="device-node-link"
                  />
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => platformService.openExternal(node.installationUrl!)}
                    data-testid="device-node-download"
                  >
                    <Download className="size-4" />
                    {t("download")}
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "node-enable", id: node.id, enabled: !node.enabled })
                  }
                  data-testid="device-node-toggle"
                >
                  {t(node.enabled ? "disable" : "enable")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: t("removeTitle"),
                        description: t("removeDescription"),
                        confirmLabel: t("remove"),
                        confirmVariant: "destructive",
                      })
                    )
                      await run({ action: "node-remove", id: node.id });
                  }}
                  data-testid="device-node-remove"
                >
                  {t("remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsGroupCard>
  );
}
