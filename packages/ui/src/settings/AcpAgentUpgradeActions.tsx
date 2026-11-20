import { ArrowUpCircle, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ACP_AGENT_SETTINGS_CATALOG } from "@/settings/acpAgentSettingsCatalog.js";
import { getAcpAgentUpgradePlan } from "@/settings/acpAgentUpgrades.js";
import type { useAcpAgentManagement } from "@/settings/useAcpAgentManagement.js";
import type { AcpAgent } from "@zcode/shared";

export function AcpAgentUpgradeActions({
  management,
}: {
  management: ReturnType<typeof useAcpAgentManagement>;
}) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AcpAgent[]>([]);
  const [confirming, setConfirming] = useState(false);
  const plan = getAcpAgentUpgradePlan(management.agents);
  const selection = plan.filter((item) => selected.includes(item.agent));
  const disabled = management.busy || management.loading || management.checking || confirming;
  const label = (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `settings.acpAgents.${key}` }, values);
  const name = (agent: AcpAgent) =>
    ACP_AGENT_SETTINGS_CATALOG.find((item) => item.agent === agent)!.name;
  const systemNotice = label("batchSystemNotice");
  const upgradeAll = async () => {
    if (disabled || !plan.length) return;
    if (plan.some((item) => item.action === "install")) {
      setConfirming(true);
      try {
        const confirmed = await confirmDialog({
          title: label("upgradeAll", { count: plan.length }),
          description: `${systemNotice}\n\n${plan.map((item) => `${name(item.agent)}: ${item.installedVersion} → ${item.expectedVersion}`).join("\n")}`,
          confirmLabel: label("upgradeAll", { count: plan.length }),
        });
        if (!confirmed) return;
      } finally {
        setConfirming(false);
      }
    }
    await management.upgradeAgents(plan);
  };
  const batch = management.batch;
  const succeeded = batch?.results.filter((item) => item.success).length ?? 0;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="acp-batch-upgrade"
          disabled={disabled || !plan.length}
          onClick={() => {
            setSelected([]);
            setOpen(true);
          }}
        >
          {label("batchUpgrade")}
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="acp-upgrade-all"
          disabled={disabled || !plan.length}
          onClick={() => void upgradeAll()}
        >
          <ArrowUpCircle className="size-3.5" aria-hidden="true" />
          {label("upgradeAll", { count: plan.length })}
        </Button>
      </div>
      {!plan.length && !disabled ? (
        <p className="text-ui-sm text-foreground-subtle">{label("noUpgrades")}</p>
      ) : null}
      {batch ? (
        <section
          data-testid="acp-upgrade-summary"
          aria-label={label("batchResults")}
          className="space-y-2 rounded-xl border border-border bg-card p-3 text-ui-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2" role="status">
            <span className="flex min-w-0 items-center gap-1.5">
              {batch.current ? (
                <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
              ) : null}
              {label("batchProgress", { completed: batch.results.length, total: batch.total })}
              {batch.current ? ` · ${name(batch.current)}` : ""}
            </span>
            {batch.current && !batch.stopped ? (
              <Button type="button" size="sm" variant="outline" onClick={management.stopBatch}>
                {label("stopBatch")}
              </Button>
            ) : null}
          </div>
          <p>{label("batchSummary", { succeeded, failed: batch.results.length - succeeded })}</p>
          {batch.stopped ? <p role="status">{label("batchStopped")}</p> : null}
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {batch.results.map((item) => (
              <li key={item.agent} className={item.success ? "text-success" : "text-destructive"}>
                {name(item.agent)} · {label(item.success ? "upgradeSucceeded" : "upgradeFailed")}
                {item.error ? <span className="break-words"> · {item.error}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label("batchUpgrade")}</DialogTitle>
            <DialogDescription>{label("batchUpgradeHint")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-ui-base">
            <Checkbox
              aria-label={label("selectAllUpgrades")}
              disabled={disabled || !plan.length}
              checked={
                selection.length === 0
                  ? false
                  : selection.length === plan.length
                    ? true
                    : "indeterminate"
              }
              onCheckedChange={(checked) =>
                setSelected(checked === true ? plan.map((item) => item.agent) : [])
              }
            />
            {label("selectAllUpgrades")}
          </label>
          <div className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {plan.map((item) => (
              <label
                key={item.agent}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover"
              >
                <Checkbox
                  aria-label={label("selectUpgrade", { name: name(item.agent) })}
                  disabled={disabled}
                  checked={selected.includes(item.agent)}
                  onCheckedChange={(checked) =>
                    setSelected((previous) =>
                      checked === true
                        ? [...previous.filter((agent) => agent !== item.agent), item.agent]
                        : previous.filter((agent) => agent !== item.agent),
                    )
                  }
                />
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-ui-base font-medium">{name(item.agent)}</span>
                  <span className="block break-all font-mono text-ui-sm text-foreground-subtle">
                    {item.installedVersion} → {item.expectedVersion}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {selection.some((item) => item.action === "install") ? (
            <p className="text-ui-sm text-foreground-subtle">{systemNotice}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {label("cancelBatch")}
            </Button>
            <Button
              type="button"
              data-testid="acp-upgrade-selected"
              disabled={disabled || !selection.length}
              onClick={() => {
                setOpen(false);
                void management.upgradeAgents(selection);
              }}
            >
              {label("upgradeSelected", { count: selection.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
