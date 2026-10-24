import { useState } from "react";
import { Download } from "lucide-react";
import type { DeviceNodeCommand, DeviceNodePlatform } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
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
  busy,
  run,
}: {
  busy: boolean;
  run(command: DeviceNodeCommand): Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [platform, setPlatform] = useState<DeviceNodePlatform>("win32-x64");
  const t = (key: string) => intl.formatMessage({ id: `settings.devices.node.${key}` });
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
            onClick={() => void run({ action: "download-node", platform })}
            data-testid="device-node-download"
          >
            <Download className="size-4" />
            {t("download")}
          </Button>
        </div>
      </div>
    </SettingsGroupCard>
  );
}
