import { memo } from "react";
import {
  BrainIcon,
  ChevronDownIcon,
  CpuIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";
import type { AcpAgent, AcpConfigOption, AcpModeState } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isCoarseTouchDevice } from "@/lib/pickerFocus.js";
import { TID_V4_COMPOSER_INPUT } from "@zcode/shared";
import {
  acpConfigChoiceLabel,
  acpConfigDescription,
  acpConfigGroupLabel,
  acpConfigOptionLabel,
} from "@/v4/composer/acpConfigLocalization.js";

interface Props {
  agent: AcpAgent;
  sessionId?: string | null;
  options: AcpConfigOption[];
  modes: AcpModeState | null;
  loading?: boolean;
  disabled: boolean;
  onChange?: (id: string, value: string | boolean) => Promise<void>;
  focusSelectorOnClose?: string | null;
  defaultOption?: {
    label: string;
    selectedIds: string[];
    onSelect(id: string): Promise<void>;
  };
}

function categoryIcon(category?: string) {
  switch (category) {
    case "mode":
      return ShieldCheckIcon;
    case "collaboration_mode":
      return UsersIcon;
    case "model":
      return CpuIcon;
    case "thought_level":
      return BrainIcon;
    case "model_config":
      return ZapIcon;
    default:
      return null;
  }
}

/** ACP 的选项及当前值只读 Host 快照；编辑命令回到该会话的 Agent。 */
function AcpComposerConfigControlsImpl({
  agent,
  sessionId,
  options,
  modes,
  loading = false,
  disabled,
  onChange,
  defaultOption,
  focusSelectorOnClose = `[data-testid="${TID_V4_COMPOSER_INPUT}"]`,
}: Props) {
  const { intl, locale } = useZCodeIntl();
  const controls: AcpConfigOption[] = options.length
    ? options
    : modes
      ? [
          {
            id: "mode",
            name: intl.formatMessage({ id: "chat.toolbar.mode.label" }),
            category: "mode",
            type: "select",
            currentValue: modes.currentModeId,
            options: modes.availableModes.map(({ id, name, description }) => ({
              value: id,
              name,
              ...(description ? { description } : {}),
            })),
          },
        ]
      : [];
  const change = (id: string, value: string | boolean) => {
    // Hook 将失败写入当前会话的错误提示；事件处理器不产生未处理的 Promise。
    void onChange?.(id, value).catch(() => {});
  };
  return (
    <div className="flex min-w-0 items-center gap-1" data-testid="acp-composer-config-controls">
      {loading ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled
          data-testid="acp-config-loading"
          data-composer-collapse-priority="1"
          aria-label={intl.formatMessage({ id: "acp.loadingControls" })}
          className="h-7 gap-1 rounded-lg px-2 text-ui-base"
        >
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          <span className="hidden sm:inline">
            {intl.formatMessage({ id: "acp.loadingControls" })}
          </span>
        </Button>
      ) : null}
      {controls.map((option) => {
        if (option.type === "select" && option.options.length === 0) return null;
        const choices =
          option.type === "select"
            ? option.options.flatMap((item) => ("group" in item ? item.options : [item]))
            : [];
        const inherited = defaultOption?.selectedIds.includes(option.id) ?? false;
        let defaultValue = "__zcode_inherit_default__";
        while (choices.some((choice) => choice.value === defaultValue)) defaultValue += "_";
        const selectedName = inherited
          ? defaultOption!.label
          : option.type === "boolean"
            ? intl.formatMessage({
                id: option.currentValue
                  ? "chat.toolbar.thoughtLevel.value.on"
                  : "chat.toolbar.thoughtLevel.value.off",
              })
            : (() => {
                const selected = choices.find((choice) => choice.value === option.currentValue);
                return selected
                  ? acpConfigChoiceLabel(locale, agent, option, selected)
                  : option.currentValue;
              })();
        const label = acpConfigOptionLabel(locale, agent, option);
        const title = `${label}: ${selectedName}`;
        const Icon = categoryIcon(option.category);
        return (
          <DropdownMenu key={`${agent}:${sessionId ?? "pending"}:${option.id}`}>
            <ControlHintTooltip title={title}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || !onChange}
                  data-testid={`acp-config-trigger-${option.id}`}
                  data-composer-collapse-priority="1"
                  aria-label={title}
                  className="group/acp h-7 max-w-44 gap-1 rounded-lg px-2 text-ui-base data-[composer-compact=true]:w-8 data-[composer-compact=true]:px-0"
                >
                  <span className="truncate group-data-[composer-compact=true]/acp:hidden">
                    {title}
                  </span>
                  {Icon ? (
                    <Icon
                      className="hidden size-4 group-data-[composer-compact=true]/acp:block"
                      aria-hidden="true"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="hidden group-data-[composer-compact=true]/acp:inline"
                    >
                      {label.slice(0, 2)}
                    </span>
                  )}
                  <ChevronDownIcon className="size-3.5 shrink-0 group-data-[composer-compact=true]/acp:hidden" />
                </Button>
              </DropdownMenuTrigger>
            </ControlHintTooltip>
            <DropdownMenuContent
              side="top"
              sideOffset={4}
              align="start"
              className="max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (!isCoarseTouchDevice() && focusSelectorOnClose)
                  document.querySelector<HTMLElement>(focusSelectorOnClose)?.focus();
              }}
            >
              {option.description ? (
                <>
                  <DropdownMenuLabel className="whitespace-normal text-foreground-subtle">
                    {acpConfigDescription(locale, agent, option, option.description)}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {option.type === "boolean" && !defaultOption ? (
                <DropdownMenuCheckboxItem
                  checked={option.currentValue}
                  onCheckedChange={(checked) => change(option.id, checked)}
                  data-testid={`acp-config-choice-${option.id}-${!option.currentValue}`}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ) : (
                <DropdownMenuRadioGroup
                  value={inherited ? defaultValue : String(option.currentValue)}
                  onValueChange={(value) => {
                    if (defaultOption && value === defaultValue) {
                      void defaultOption.onSelect(option.id).catch(() => {});
                    } else change(option.id, option.type === "boolean" ? value === "true" : value);
                  }}
                >
                  {defaultOption ? (
                    <>
                      <DropdownMenuRadioItem
                        value={defaultValue}
                        data-testid={`acp-config-default-${option.id}`}
                      >
                        {defaultOption.label}
                      </DropdownMenuRadioItem>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  {option.type === "boolean"
                    ? [true, false].map((value) => (
                        <DropdownMenuRadioItem
                          key={String(value)}
                          value={String(value)}
                          data-testid={`acp-config-choice-${option.id}-${value}`}
                        >
                          {intl.formatMessage({
                            id: value
                              ? "chat.toolbar.thoughtLevel.value.on"
                              : "chat.toolbar.thoughtLevel.value.off",
                          })}
                        </DropdownMenuRadioItem>
                      ))
                    : option.options.map((item) =>
                        "group" in item ? (
                          <div key={`group:${item.group}`}>
                            <DropdownMenuLabel>
                              {acpConfigGroupLabel(locale, item.name)}
                            </DropdownMenuLabel>
                            {item.options.map((choice) => (
                              <DropdownMenuRadioItem
                                key={choice.value}
                                value={choice.value}
                                data-testid={`acp-config-choice-${option.id}-${choice.value}`}
                                className="items-start"
                              >
                                <span className="flex min-w-0 flex-col gap-0.5">
                                  <span>{acpConfigChoiceLabel(locale, agent, option, choice)}</span>
                                  {choice.description ? (
                                    <span className="text-ui-sm text-foreground-subtle">
                                      {acpConfigDescription(
                                        locale,
                                        agent,
                                        option,
                                        choice.description,
                                      )}
                                    </span>
                                  ) : null}
                                </span>
                              </DropdownMenuRadioItem>
                            ))}
                          </div>
                        ) : (
                          <DropdownMenuRadioItem
                            key={item.value}
                            value={item.value}
                            data-testid={`acp-config-choice-${option.id}-${item.value}`}
                            className="items-start"
                          >
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span>{acpConfigChoiceLabel(locale, agent, option, item)}</span>
                              {item.description ? (
                                <span className="text-ui-sm text-foreground-subtle">
                                  {acpConfigDescription(locale, agent, option, item.description)}
                                </span>
                              ) : null}
                            </span>
                          </DropdownMenuRadioItem>
                        ),
                      )}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </div>
  );
}

export const AcpComposerConfigControls = memo(AcpComposerConfigControlsImpl);
