import { RefreshCw } from "lucide-react";
import type { AgentProfileSave } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useAgentProfileConfigs } from "@/hooks/useAgentProfileConfigs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { AcpComposerConfigControls } from "@/v4/composer/AcpComposerConfigControls.js";

export function AgentProfileAcpConfig({
  execution,
  workspacePath,
  disabled,
  onChange,
}: {
  execution: Extract<AgentProfileSave["execution"], { kind: "acp" }>;
  workspacePath: string | null;
  disabled: boolean;
  onChange(execution: AgentProfileSave["execution"]): void;
}) {
  const catalog = useAgentProfileConfigs(workspacePath);
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `agentProfiles.${key}` });
  const known = catalog.configs.find((snapshot) => snapshot.agent === execution.agent);
  const options = (known?.configOptions ?? [])
    .filter(
      (option) =>
        option.category === "model" || option.id === "model" || option.category === "thought_level",
    )
    .map((option) => {
      const saved = execution.config.find((item) => item.configId === option.id);
      return option.type === "boolean"
        ? {
            ...option,
            currentValue: typeof saved?.value === "boolean" ? saved.value : option.currentValue,
          }
        : {
            ...option,
            currentValue: typeof saved?.value === "string" ? saved.value : option.currentValue,
          };
    });
  // 修复原因：历史选项只用于显示菜单，未主动选择的模型和思考强度必须继续使用运行时默认值。
  const change = async (configId: string, value?: string | boolean) =>
    onChange({
      ...execution,
      config: [
        ...execution.config.filter((item) => item.configId !== configId),
        ...(value === undefined ? [] : [{ configId, value }]),
      ],
    });
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <AcpComposerConfigControls
          agent={execution.agent}
          options={options}
          modes={null}
          loading={catalog.loading}
          disabled={disabled}
          onChange={change}
          defaultOption={{
            label: t("runtimeDefault"),
            selectedIds: options
              .filter((option) => !execution.config.some((item) => item.configId === option.id))
              .map((option) => option.id),
            onSelect: (id) => change(id),
          }}
          focusSelectorOnClose={null}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          data-testid="agent-profile-config-refresh"
          aria-label={t("refreshConfig")}
          disabled={disabled || catalog.loading || !workspacePath}
          onClick={() => void catalog.refresh()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {catalog.error ? (
        <p role="alert" className="text-ui-caption text-destructive">
          {t("configFailed")}
        </p>
      ) : !catalog.loading && !options.length ? (
        <p className="text-ui-caption text-foreground-subtle">{t("configUnavailable")}</p>
      ) : null}
      {execution.config
        .filter((item) => !options.some((option) => option.id === item.configId))
        .map((item) => (
          <p key={item.configId} className="break-all text-ui-caption text-foreground-subtle">
            {item.configId}: {String(item.value)}
          </p>
        ))}
    </div>
  );
}
