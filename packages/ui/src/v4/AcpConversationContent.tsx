import type { AcpAgent } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { acpErrorMessageId } from "@/v4/acpErrorMessage.js";
import type { useAcpConversation } from "@/v4/useAcpConversation.js";
import { ChatErrorBanner } from "@/ChatErrorBanner.js";

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
  // 错误已绑定原提问时，由轮尾横幅展示；footer 只保留尚未接纳的操作错误和权限。
  const savedError =
    selected?.error &&
    selected.entries.some(
      (entry) =>
        entry.kind === "user" &&
        entry.traceError &&
        entry.traceError === selected.error &&
        (selected.errorCommandId === undefined || entry.id === `user:${selected.errorCommandId}`),
    );
  const operationError =
    (error && !(savedError && error === selected?.error) ? error : null) ||
    (savedError ? null : selected?.error);
  if (!operationError && !selected?.pendingPermission) return null;
  return (
    <section
      data-testid="acp-conversation-status"
      className="mx-auto w-full space-y-4 px-4 pb-4 text-ui-base"
    >
      {operationError ? (
        <ChatErrorBanner
          error={{ code: "ACP_OPERATION_FAILED", message: errorText(operationError) }}
          onRetry={!selected ? conversation.retryConnection : undefined}
          onDismiss={conversation.dismissError}
        />
      ) : null}
      {selected?.pendingPermission ? (
        <div
          data-testid="acp-permission"
          className="rounded-lg border border-border bg-interaction-confirmation-surface p-3 text-ui-base"
        >
          <p className="mb-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
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
    <div className="pointer-events-auto absolute inset-x-4 top-4 z-20 mx-auto max-w-2xl">
      <ChatErrorBanner
        error={{ code: "ACP_CONNECTION_FAILED", message: id ? intl.formatMessage({ id }) : error }}
        onRetry={conversation.retryConnection}
        onDismiss={conversation.dismissError}
      />
    </div>
  );
}
