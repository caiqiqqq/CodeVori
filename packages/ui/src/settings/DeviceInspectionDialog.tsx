import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog.js";
import { useDeviceInspection } from "@/hooks/useDeviceInspection.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function DeviceInspectionDialog({
  nodeId,
  name,
  onClose,
}: {
  nodeId: string;
  name: string;
  onClose(): void;
}) {
  const { intl, locale } = useZCodeIntl();
  const number = (n: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  const t = (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `settings.devices.inspect.${key}` }, values);
  const { system, screen, busy, errors, read } = useDeviceInspection(nodeId);
  const bytes = (n: number | null | undefined) =>
    n == null ? t("unavailable") : `${number(n / 1024 / 1024)} MiB`;
  const percent = (n: number | null | undefined) =>
    n == null ? t("unavailable") : `${number(n)}%`;
  const time = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  const buttonClass = "h-auto min-h-7 max-w-full whitespace-normal py-1";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-4rem)] min-w-0 overflow-y-auto sm:max-w-3xl"
        data-testid="device-inspection"
      >
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="break-all">{t("title", { name })}</DialogTitle>
          <DialogDescription className="break-all">{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className={buttonClass}
            variant="outline"
            disabled={busy.system}
            onClick={() => void read("system")}
            data-testid="device-inspection-refresh"
          >
            {t(busy.system ? "loading" : "refresh")}
          </Button>
          {system ? (
            <span
              className="text-ui-sm text-foreground-subtle"
              data-testid="device-inspection-time"
            >
              {t("sampledAt", { time: time(system.sampledAt) })}
            </span>
          ) : null}
        </div>
        {errors.system ? (
          <p
            role="alert"
            className="text-ui-sm text-destructive"
            data-testid="device-inspection-error"
          >
            {t("systemError")}
          </p>
        ) : null}
        {system ? (
          <div className="min-w-0 space-y-4" data-testid="device-inspection-system">
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-border p-3">
                <h3 className="text-ui-base font-medium">CPU · {percent(system.cpuPercent)}</h3>
                <p className="break-all text-ui-sm text-foreground-subtle">
                  {system.cpuModel || t("unavailable")} · {t("cores", { count: system.cpuCount })}
                </p>
                <p className="text-ui-sm text-foreground-subtle">
                  {system.platform} · {system.architecture}
                </p>
                {system.cpuPercent !== null ? (
                  <progress
                    className="mt-2 h-2 w-full accent-brand"
                    max={100}
                    value={system.cpuPercent}
                    aria-label={t("cpu")}
                  />
                ) : null}
              </div>
              <div className="min-w-0 rounded-xl border border-border p-3">
                <h3 className="text-ui-base font-medium">{t("memory")}</h3>
                <p className="break-words text-ui-sm">
                  {t("memoryUsed", {
                    used: bytes(system.memory?.usedBytes),
                    total: bytes(system.memory?.totalBytes),
                  })}
                </p>
                <p className="text-ui-sm text-foreground-subtle">
                  {t("memoryAvailable", { value: bytes(system.memory?.availableBytes) })}
                </p>
                {system.memory && system.memory.totalBytes > 0 ? (
                  <progress
                    className="mt-2 h-2 w-full accent-brand"
                    max={system.memory.totalBytes}
                    value={system.memory.usedBytes}
                    aria-label={t("memory")}
                  />
                ) : null}
              </div>
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-ui-base font-medium">{t("processes")}</h3>
              <p className="text-ui-sm text-foreground-subtle">
                {t("coverage", {
                  shown: system.processes.length,
                  inspected: system.inspectedProcessCount,
                  total: system.processCount ?? t("unavailable"),
                })}{" "}
                {system.processesPartial ? t("partial") : ""}
              </p>
              <div className="max-h-64 overflow-auto rounded-xl border border-border">
                <table
                  className="w-full min-w-[32rem] table-fixed text-ui-sm"
                  data-testid="device-inspection-processes"
                >
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      <th className="w-14 p-2 text-left">PID</th>
                      <th className="p-2 text-left">{t("processName")}</th>
                      <th className="w-20 p-2 text-right">{t("rss")}</th>
                      <th className="w-20 p-2 text-right">{t("cpuTime")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {system.processes.map((p) => (
                      <tr key={p.pid} className="border-t border-border">
                        <td className="break-all p-2 align-top">{p.pid}</td>
                        <td className="break-all p-2 align-top">{p.name}</td>
                        <td className="break-words p-2 text-right align-top">
                          {bytes(p.rssBytes)}
                        </td>
                        <td className="break-words p-2 text-right align-top">
                          {p.cpuSeconds === null ? t("unavailable") : number(p.cpuSeconds) + " s"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
        <div className="min-w-0 space-y-2 border-t border-border pt-3">
          <h3 className="text-ui-base font-medium">{t("screen")}</h3>
          <p className="text-ui-sm text-foreground-subtle">{t("screenDescription")}</p>
          <Button
            className={buttonClass}
            variant="outline"
            disabled={busy.screen}
            onClick={() => void read("screen")}
            data-testid="device-inspection-screen-refresh"
          >
            {t(busy.screen ? "loading" : "capture")}
          </Button>
          {errors.screen ? (
            <p role="alert" className="text-ui-sm text-destructive">
              {t("screenError")}
            </p>
          ) : null}
          {screen ? (
            <>
              <p className="text-ui-sm text-foreground-subtle">
                {t("receivedAt", { time: time(screen.sampledAt) })}
              </p>
              <img
                className="h-auto max-h-96 w-full rounded-lg border border-border object-contain"
                src={`data:image/png;base64,${screen.data}`}
                alt={t("screenAlt", { name })}
                data-testid="device-inspection-screen"
              />
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
