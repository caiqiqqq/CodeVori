import { CheckIcon, HistoryIcon, PlusIcon, Trash2 } from "lucide-react";
import { acpAgentDefinition, type AcpAgent } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { acpErrorMessageId } from "@/v4/acpErrorMessage.js";
import type { useAcpConversation } from "@/v4/useAcpConversation.js";

/** 会话操作收进原输入框工具栏；消息统一由原 ConversationTimeline 渲染。 */
export function AcpConversationControls({
  agent,
  conversation,
}: {
  agent: AcpAgent;
  conversation: ReturnType<typeof useAcpConversation>;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `acp.${key}` });
  const { selected, agentSessions, busy } = conversation;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid="acp-conversation-controls"
          aria-label={`${acpAgentDefinition(agent).name} · ${t("sessions")}`}
          title={t("sessions")}
          className="shrink-0 rounded-lg"
        >
          <HistoryIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <DropdownMenuLabel>
          {acpAgentDefinition(agent).name} · {t("sessions")}
        </DropdownMenuLabel>
        {agentSessions.map((session) => (
          <DropdownMenuItem
            key={session.id}
            data-testid={`acp-session-item-${session.id}`}
            disabled={busy}
            onSelect={() => conversation.select(session)}
            className="gap-2"
          >
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            {session.id === selected?.id ? <CheckIcon className="size-4 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
        {selected?.goal ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="whitespace-pre-wrap break-words font-normal text-foreground-subtle">
              {t("goal")}: {selected.goal}
            </DropdownMenuLabel>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={() => conversation.create(agent)}>
          <PlusIcon className="mr-2 size-4" />
          {t("newSession")}
        </DropdownMenuItem>
        {selected ? (
          <DropdownMenuItem
            disabled={busy}
            onSelect={conversation.remove}
            className="text-destructive"
          >
            <Trash2 className="mr-2 size-4" />
            {t("remove")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 权限和错误保留 Host 回执语义，落在原时间线消息尾部。 */
export function AcpConversationStatus({
  agent,
  conversation,
}: {
  agent: AcpAgent;
  conversation: ReturnType<typeof useAcpConversation>;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `acp.${key}` });
  const errorText = (message: string) => {
    const id = acpErrorMessageId(agent, message);
    return id ? intl.formatMessage({ id }) : message;
  };
  const { selected, error, busy } = conversation;
  if (!error && !selected?.error && !selected?.pendingPermission) return null;
  return (
    <section
      data-testid="acp-conversation-status"
      className="mx-auto w-full space-y-4 px-4 pb-4 text-ui-base"
    >
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-ui-base text-destructive"
        >
          {errorText(error)}{" "}
          {!selected ? (
            <button type="button" className="underline" onClick={conversation.retryConnection}>
              {t("retry")}
            </button>
          ) : (
            <button type="button" className="underline" onClick={conversation.dismissError}>
              {t("dismiss")}
            </button>
          )}
        </div>
      ) : null}
      {selected?.error && selected.error !== error ? (
        <div role="alert" className="text-ui-base text-destructive">
          {errorText(selected.error)}
        </div>
      ) : null}
      {selected?.pendingPermission ? (
        <div
          data-testid="acp-permission"
          className="rounded-lg border border-border bg-interaction-confirmation-surface p-3 text-ui-base"
        >
          <p className="mb-2">
            {t("permission")}: {selected.pendingPermission.title}
          </p>
          <div className="flex flex-wrap gap-2">
            {selected.pendingPermission.options.map((option) => (
              <button
                key={option.optionId}
                type="button"
                disabled={busy}
                onClick={() =>
                  conversation.decide(selected.pendingPermission!.requestId, option.optionId)
                }
                className="rounded-lg border border-border bg-surface px-3 py-1 disabled:opacity-50"
              >
                {option.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** 首页的连接错误独立浮在时间线上方，保留问候语和输入框的居中布局。 */
export function AcpHomeStatus({
  agent,
  conversation,
}: {
  agent: AcpAgent;
  conversation: ReturnType<typeof useAcpConversation>;
}) {
  const { intl } = useZCodeIntl();
  // 修复原因：旧会话快照的错误不是本次选择产生的认证结果，空白首页仅显示当前操作错误。
  const error = conversation.error;
  if (!error) return null;
  const id = acpErrorMessageId(agent, error);
  return (
    <div
      role="alert"
      className="pointer-events-auto absolute inset-x-4 top-4 z-20 mx-auto flex w-full max-w-2xl items-center gap-3 rounded-lg border border-destructive/40 bg-surface px-3 py-2 text-ui-base text-destructive shadow-md"
    >
      <span className="min-w-0 flex-1 break-words">{id ? intl.formatMessage({ id }) : error}</span>
      <button
        type="button"
        className="shrink-0 underline"
        onClick={() => {
          conversation.retryConnection();
        }}
      >
        {intl.formatMessage({ id: "acp.retry" })}
      </button>
      <button type="button" className="shrink-0 underline" onClick={conversation.dismissError}>
        {intl.formatMessage({ id: "acp.dismiss" })}
      </button>
    </div>
  );
}
