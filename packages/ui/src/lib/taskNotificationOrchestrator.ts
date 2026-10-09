import type { AcpSession, TaskNotificationPayload } from "@zcode/shared";
import type {
  ConversationSnapshot,
  PendingInteraction,
  SessionPhase,
  SessionSummary,
  UserInputRequestPayload,
} from "@zcode/shared/zcode-protocol-v4";
import type { IntlInstance } from "@/i18n/index.js";

type FormatMessage = IntlInstance["formatMessage"];

function terminalStatusForPhase(
  phase: SessionPhase,
): Extract<TaskNotificationPayload["status"], "completed" | "failed"> | null {
  if (phase === "completedSuccess" || phase === "completedInterrupted") {
    return "completed";
  }
  if (phase === "error") {
    return "failed";
  }
  return null;
}

function taskTitleBody(
  title: string,
  fallbackMessageId: string,
  formatMessage: FormatMessage,
): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle) {
    return formatMessage({ id: "notification.taskWithTitle" }, { title: trimmedTitle });
  }
  return formatMessage({ id: fallbackMessageId });
}

function terminalPayloadForSession(
  session: Pick<SessionSummary, "sessionId" | "title">,
  status: Extract<TaskNotificationPayload["status"], "completed" | "failed">,
  formatMessage: FormatMessage,
): TaskNotificationPayload {
  if (status === "completed") {
    return {
      taskId: session.sessionId,
      status,
      title: formatMessage({ id: "notification.completed" }),
      body: taskTitleBody(session.title, "notification.completedBody", formatMessage),
    };
  }

  return {
    taskId: session.sessionId,
    status,
    title: formatMessage({ id: "notification.error" }),
    body: taskTitleBody(session.title, "notification.error", formatMessage),
  };
}

export function collectTerminalTaskNotificationPayloads(params: {
  previousBySessionId: ReadonlyMap<string, SessionSummary>;
  sessions: readonly SessionSummary[];
  formatMessage: FormatMessage;
}): TaskNotificationPayload[] {
  const payloads: TaskNotificationPayload[] = [];
  for (const session of params.sessions) {
    const status = terminalStatusForPhase(session.phase);
    if (!status) continue;

    const previous = params.previousBySessionId.get(session.sessionId);
    if (!previous) continue;

    const previousStatus = terminalStatusForPhase(previous.phase);
    if (previousStatus === status) continue;

    payloads.push(terminalPayloadForSession(session, status, params.formatMessage));
  }
  return payloads;
}

export const ACP_TASK_NOTIFICATION_PREFIX = "acp:";

export type AcpTaskNotificationState = Pick<
  AcpSession,
  "id" | "revision" | "status" | "title" | "error" | "provisional" | "archived" | "supersededBy"
> & { pauseReason: AcpSession["queue"]["pauseReason"] };

export function toAcpTaskNotificationState(session: AcpSession): AcpTaskNotificationState {
  return {
    id: session.id,
    revision: session.revision,
    status: session.status,
    title: session.title,
    error: session.error,
    provisional: session.provisional,
    archived: session.archived,
    supersededBy: session.supersededBy,
    pauseReason: session.queue.pauseReason,
  };
}

export function getAcpTerminalTaskNotificationPayload(
  previous: AcpTaskNotificationState | undefined,
  next: AcpTaskNotificationState,
  formatMessage: FormatMessage,
): TaskNotificationPayload | null {
  if (
    !previous ||
    previous.id !== next.id ||
    previous.status !== "running" ||
    next.revision <= previous.revision ||
    next.status === "running" ||
    next.provisional ||
    next.archived ||
    next.supersededBy
  ) {
    return null;
  }
  // 修复依据：ACP stop 也会写 idle，必须结合 Host 的队列停止事实，不能把停止当成功。
  const status = next.error
    ? "failed"
    : next.status === "idle" && next.pauseReason !== "stopped" && next.pauseReason !== "error"
      ? "completed"
      : null;
  return status
    ? terminalPayloadForSession(
        { sessionId: `${ACP_TASK_NOTIFICATION_PREFIX}${next.id}`, title: next.title },
        status,
        formatMessage,
      )
    : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanApprovalInteraction(payload: UserInputRequestPayload): boolean {
  if (payload.toolName === "ExitPlanMode") {
    return true;
  }
  if (!isPlainRecord(payload.schema)) {
    return false;
  }
  return (
    payload.schema.interaction === "plan_approval" || payload.schema.toolName === "ExitPlanMode"
  );
}

function pendingInteractionPayload(params: {
  snapshot: ConversationSnapshot;
  interaction: PendingInteraction;
  formatMessage: FormatMessage;
}): TaskNotificationPayload | null {
  const { snapshot, interaction, formatMessage } = params;
  const requestId = interaction.interactionId;
  const taskId = snapshot.sessionId;
  const taskTitle = snapshot.meta.title;

  // workspace Hook review 的唯一入口是 Settings；不得把它伪装成
  // permission/elicitation 系统通知。
  if (interaction.payload.kind === "workspaceHookReview") {
    return null;
  }

  if (interaction.payload.kind === "permission") {
    return {
      taskId,
      status: "permission_request",
      requestId,
      title: formatMessage({ id: "notification.permissionRequired" }),
      body:
        interaction.payload.summary.trim() ||
        taskTitleBody(taskTitle, "notification.permissionRequired", formatMessage),
    };
  }

  if (isPlanApprovalInteraction(interaction.payload)) {
    return {
      taskId,
      status: "elicitation_request",
      requestId,
      title: formatMessage({ id: "notification.planApprovalRequired" }),
      body: formatMessage({ id: "notification.planApprovalBody" }),
    };
  }

  return {
    taskId,
    status: "elicitation_request",
    requestId,
    title: formatMessage({ id: "notification.inputRequired" }),
    body:
      interaction.payload.prompt.trim() ||
      taskTitleBody(taskTitle, "notification.inputRequired", formatMessage),
  };
}

export function collectPendingInteractionNotificationPayloads(params: {
  snapshot: ConversationSnapshot;
  seenRequestIds: ReadonlySet<string>;
  formatMessage: FormatMessage;
}): TaskNotificationPayload[] {
  return params.snapshot.pendingInteractions
    .filter((interaction) => !params.seenRequestIds.has(interaction.interactionId))
    .flatMap((interaction) => {
      const payload = pendingInteractionPayload({
        snapshot: params.snapshot,
        interaction,
        formatMessage: params.formatMessage,
      });
      return payload ? [payload] : [];
    });
}
