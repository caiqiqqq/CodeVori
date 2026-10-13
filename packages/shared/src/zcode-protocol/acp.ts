/* eslint-disable max-lines -- ACP wire schemas stay together so session snapshots remain compatible across Host and UI. */
import { z } from "zod";
import { acpElicitationSchema } from "../acp-elicitation.js";
import { acpPlanStepSchema } from "../acp-plan.js";
import { acpTokenUsageSchema, acpUsageTurnSchema } from "../acp-usage.js";
import { workflowRunsStateSchema } from "../zcode-protocol-v4/workflow-runs.js";
import { attachmentRefSchema } from "../zcode-protocol-v4/attachment-ref.js";
import { acpWorkflowToolSchema } from "./acpWorkflow.js";
import { acpTerminalSchema } from "../acp-terminal.js";
export * from "../acp-terminal.js";

/** ACP Agent identity is independent of the ZCode model Provider registry. */
export const acpAgentSchema = z.enum([
  "claude",
  "codex",
  "gemini",
  "openclaw",
  "opencode",
  "cline",
  "hermes",
  "codebuddy",
  "kimi-code",
  "pi",
  "grok",
  "cursor",
  "deepseek",
  "qoder",
  "antigravity",
]);
export type AcpAgent = z.infer<typeof acpAgentSchema>;

/** Gemini authentication choices accepted by the target Host and settings editor. */
export const ACP_GEMINI_AUTH_MODES = [
  "custom",
  "login_google",
  "gemini_api_key",
  "vertex_adc",
  "vertex_service_account",
  "vertex_api_key",
  "model_provider",
] as const;
export type AcpGeminiAuthMode = (typeof ACP_GEMINI_AUTH_MODES)[number];

/** Native Gemini providers belong to the target ACP Host, independently of the API registry. */
export const acpGeminiProviderSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(128),
    apiUrl: z
      .string()
      .trim()
      .url()
      .max(8192)
      .refine((value) => /^https?:\/\//.test(value)),
    apiKey: z.string().trim().min(1).max(8192),
    model: z.string().trim().max(256),
  })
  .strict();
export type AcpGeminiProvider = z.infer<typeof acpGeminiProviderSchema>;
export const acpGeminiProvidersSchema = z
  .object({
    version: z.string().min(1),
    providers: z.array(acpGeminiProviderSchema).max(64),
  })
  .strict();
export type AcpGeminiProviders = z.infer<typeof acpGeminiProvidersSchema>;
export const acpGeminiProvidersUpdateSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("upsert"),
      expectedVersion: z.string().min(1),
      provider: acpGeminiProviderSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("delete"),
      expectedVersion: z.string().min(1),
      id: z.string().uuid(),
    })
    .strict(),
]);
export type AcpGeminiProvidersUpdate = z.infer<typeof acpGeminiProvidersUpdateSchema>;

/** Stable identities and ACP launch arguments shared by settings, composer and Host. */
export const ACP_AGENT_CATALOG = [
  { id: "claude", name: "Claude ACP", command: "claude-agent-acp", args: [] },
  { id: "codex", name: "Codex ACP", command: "codex-acp", args: [] },
  { id: "gemini", name: "Gemini CLI", command: "gemini", args: ["--acp", "--skip-trust"] },
  { id: "openclaw", name: "OpenClaw", command: "openclaw", args: ["acp"] },
  { id: "opencode", name: "OpenCode", command: "opencode", args: ["acp"] },
  { id: "cline", name: "Cline", command: "cline", args: ["--acp"] },
  { id: "hermes", name: "Hermes Agent", command: "hermes", args: ["acp"] },
  { id: "codebuddy", name: "CodeBuddy", command: "codebuddy", args: ["--acp"] },
  { id: "kimi-code", name: "Kimi Code", command: "kimi", args: ["acp"] },
  { id: "pi", name: "Pi", command: "pi-acp", args: [] },
  { id: "grok", name: "Grok", command: "grok", args: ["--no-auto-update", "agent", "stdio"] },
  { id: "cursor", name: "Cursor", command: "cursor-agent", args: ["acp"] },
  { id: "deepseek", name: "DeepSeek Harness", command: "deepseek-acp", args: [] },
  { id: "qoder", name: "Qoder", command: "qoder", args: ["--acp"] },
  { id: "antigravity", name: "Google Antigravity", command: "agy_acp_server", args: [] },
] as const satisfies readonly {
  id: AcpAgent;
  name: string;
  command: string;
  args: readonly string[];
}[];

export function acpAgentDefinition(agent: AcpAgent) {
  return ACP_AGENT_CATALOG.find((item) => item.id === agent)!;
}

/** Target-Host Agent SDK state. An installed vendor CLI is not an ACP adapter. */
export const acpAgentListOptionsSchema = z
  .object({
    checkUpdates: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .strict();
export type AcpAgentListOptions = z.infer<typeof acpAgentListOptionsSchema>;

export const acpAgentUpdateCheckSchema = z
  .object({
    status: z.enum(["unchecked", "checked", "error", "unavailable"]),
    source: z.enum(["builtin", "acp-registry", "npm"]),
    checkedAt: z.string().datetime().nullable(),
  })
  .strict();

export const acpAgentInfoSchema = z.object({
  agent: acpAgentSchema,
  command: z.string(),
  args: z.array(z.string()).default([]),
  distribution: z.enum(["npm", "binary"]).default("npm"),
  platformSupported: z.boolean().default(true),
  packageName: z.string(),
  registryVersion: z.string(),
  updateCheck: acpAgentUpdateCheckSchema.optional(),
  enabled: z.boolean(),
  env: z.record(z.string(), z.string()),
  source: z.enum(["managed", "system", "missing"]),
  ready: z.boolean(),
  installedVersion: z.string().nullable(),
  managedVersion: z.string().nullable(),
  executablePath: z.string().nullable(),
  nativeCommand: z.string(),
  nativePath: z.string().nullable(),
  nodeVersion: z.string().nullable(),
  npmVersion: z.string().nullable(),
});
export type AcpAgentInfo = z.infer<typeof acpAgentInfoSchema>;

/** Lightweight target-Host availability for the composer; full diagnostics use AcpAgentInfo. */
export const acpAgentAvailabilitySchema = z.object({
  agent: acpAgentSchema,
  enabled: z.boolean(),
  ready: z.boolean(),
});
export const acpAgentAvailabilityListSchema = z.array(acpAgentAvailabilitySchema);
export type AcpAgentAvailability = z.infer<typeof acpAgentAvailabilitySchema>;

export const acpAgentUpdateSchema = z
  .object({
    agent: acpAgentSchema,
    enabled: z.boolean().optional(),
    env: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(8192))
      .refine(
        (value) =>
          Object.keys(value).length <= 32 &&
          !Object.keys(value).some((key) =>
            ["PATH", "HOME", "NODE_OPTIONS", "NPM_CONFIG_PREFIX"].includes(key.toUpperCase()),
          ),
      )
      .optional(),
  })
  .refine((value) => value.enabled !== undefined || value.env !== undefined)
  .refine(
    (value) =>
      value.agent !== "gemini" ||
      !value.env?.ZCODE_GEMINI_AUTH_MODE ||
      ACP_GEMINI_AUTH_MODES.includes(value.env.ZCODE_GEMINI_AUTH_MODE.trim() as AcpGeminiAuthMode),
    { message: "未知的 Gemini 认证方式" },
  );
export type AcpAgentUpdate = z.infer<typeof acpAgentUpdateSchema>;

/** Codex CLI native configuration belongs to the target Host, outside ACP process env. */
export const acpCodexConfigSchema = z.object({
  version: z.string().min(1),
  authMode: z.enum(["subscription", "custom"]),
  managedProvider: z.boolean(),
  hasSubscriptionCredentials: z.boolean(),
  apiUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
});
export type AcpCodexConfig = z.infer<typeof acpCodexConfigSchema>;

export const acpCodexConfigUpdateSchema = acpCodexConfigSchema
  .pick({
    authMode: true,
    apiUrl: true,
    apiKey: true,
    model: true,
  })
  .extend({
    expectedVersion: z.string().min(1),
  })
  .refine((value) => value.authMode !== "custom" || Boolean(value.apiUrl.trim()), {
    message: "自定义接口需要 API URL",
  });
export type AcpCodexConfigUpdate = z.infer<typeof acpCodexConfigUpdateSchema>;

export const acpCodexModelSchema = z.object({
  slug: z.string().min(1),
  name: z.string(),
});
export type AcpCodexModel = z.infer<typeof acpCodexModelSchema>;

export const acpAgentManagementSchema = z.object({
  agent: acpAgentSchema,
  action: z.enum(["install", "upgrade", "uninstall"]),
  operationId: z.string().uuid(),
  expectedVersion: z.string().min(1).max(128).optional(),
});
export type AcpAgentManagement = z.infer<typeof acpAgentManagementSchema>;

export const acpAgentOperationEventSchema = z.object({
  operationId: z.string().uuid(),
  agent: acpAgentSchema,
  phase: z.enum(["started", "log", "completed", "failed"]),
  message: z.string(),
});
export type AcpAgentOperationEvent = z.infer<typeof acpAgentOperationEventSchema>;

export const acpWorkspaceSchema = z.object({
  workspacePath: z.string().trim().min(1),
  workspaceIdentity: z.string().optional(),
  remoteSessionId: z.string().optional(),
});
export type AcpWorkspace = z.infer<typeof acpWorkspaceSchema>;

export const acpStopInputSchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    expectedCommandId: z.string().trim().min(1).optional(),
  })
  .strict();
export type AcpStopInput = z.infer<typeof acpStopInputSchema>;

export const acpTerminalControlSchema = acpWorkspaceSchema
  .extend({ id: z.string().min(1), terminalId: z.string().min(1).max(256) })
  .strict();
export type AcpTerminalControl = z.infer<typeof acpTerminalControlSchema>;

/** One UI submission keeps this ID across an ambiguous create RPC retry. */
export const acpCreateInputSchema = acpWorkspaceSchema.extend({
  agent: acpAgentSchema,
  requestId: z.string().uuid().optional(),
  /** Connect ACP on selection; keep the display session in Host memory until the first turn. */
  deferPersistence: z.boolean().optional(),
  /** Only composer drafts inherit the target Host's explicit permission preference. */
  usePermissionPreference: z.boolean().optional(),
});
export type AcpCreateInput = z.input<typeof acpCreateInputSchema>;

export const acpPermissionSelectionSchema = z
  .object({ configId: z.string().trim().min(1).max(256), value: z.string().min(1).max(512) })
  .strict();
export type AcpPermissionSelection = z.infer<typeof acpPermissionSelectionSchema>;

export const acpSetConfigOptionInputSchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    configId: z.string().min(1),
    value: z.union([z.string(), z.boolean()]),
    /** Explicit composer selection; internal callers omit this flag. */
    rememberPermission: z.boolean().optional(),
  })
  .strict();
export type AcpSetConfigOptionInput = z.infer<typeof acpSetConfigOptionInputSchema>;

/** Renderer 的附件草稿；内容只在本次 RPC 中流过，不进入会话快照。 */
export const acpPromptAttachmentSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(128),
    path: z.string().min(1).optional(),
    dataBase64: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.path) !== Boolean(value.dataBase64), {
    message: "ACP attachment requires exactly one path or inline payload",
  });
export type AcpPromptAttachment = z.infer<typeof acpPromptAttachmentSchema>;

export const acpPromptInputSchema = z.object({
  text: z.string(),
  commandId: z.string().min(1),
  attachments: z.array(acpPromptAttachmentSchema).max(8).default([]),
  workspaceFiles: z.array(z.string().min(1)).max(20).default([]),
});
export type AcpPromptInput = z.input<typeof acpPromptInputSchema>;

/** The same strict target/input contract is used by acceptance and whole-turn RPCs. */
export const acpPromptSubmissionSchema = acpWorkspaceSchema
  .extend({ id: z.string().min(1), ...acpPromptInputSchema.shape })
  .strict();
export type AcpPromptSubmission = z.input<typeof acpPromptSubmissionSchema>;

export const ACP_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const ACP_ATTACHMENT_READ_CHUNK_BYTES = 128 * 1024;
/** Host-owned content refs, never paths or inline content in session snapshots. */
export const acpAttachmentRefSchema = attachmentRefSchema
  .omit({ previewRef: true })
  .extend({
    ref: z.string().regex(/^acp-attachment:[0-9a-f-]{36}\/[0-7]$/i),
    fileName: z.string().min(1).max(255),
    mime: z.string().min(1).max(128),
    bytes: z.number().int().nonnegative().max(ACP_ATTACHMENT_MAX_BYTES),
  })
  .strict();
export type AcpAttachmentRef = z.infer<typeof acpAttachmentRefSchema>;

/** Host-owned pending user input; content bytes remain in the attachment store. */
export const acpQueueItemSchema = z
  .object({
    commandId: z.string().trim().min(1),
    text: z.string(),
    attachments: z.array(acpAttachmentRefSchema).max(8).default([]),
    workspaceFiles: z.array(z.string().min(1)).max(20).default([]),
    createdAt: z.number().int().nonnegative(),
    state: z.enum(["queued", "reserved"]),
  })
  .strict();
export type AcpQueueItem = z.infer<typeof acpQueueItemSchema>;
export const acpQueueStateSchema = z
  .object({
    items: z.array(acpQueueItemSchema).max(100).default([]),
    autoDrain: z.boolean().default(true),
    pauseReason: z.enum(["stopped", "manual", "error"]).optional(),
    /** Accepted then deleted inputs must not reappear after an ambiguous prompt retry. */
    discardedCommandIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export const acpQueueItemInputSchema = acpWorkspaceSchema
  .extend({
    id: z.string().uuid(),
    queueItemId: z.string().trim().min(1),
    /** 撤回编辑的内容前置条件；流式 revision 变化不应拒绝未变化的队列项。 */
    expectedItem: acpQueueItemSchema.optional(),
  })
  .strict();
export type AcpQueueItemInput = z.infer<typeof acpQueueItemInputSchema>;
export const acpQueueEditInputSchema = acpQueueItemInputSchema
  .extend({ text: z.string() })
  .strict();
export type AcpQueueEditInput = z.infer<typeof acpQueueEditInputSchema>;
export const acpQueueReorderInputSchema = acpQueueItemInputSchema
  .extend({
    beforeQueueItemId: z.string().trim().min(1).nullable(),
  })
  .strict();
export type AcpQueueReorderInput = z.infer<typeof acpQueueReorderInputSchema>;
export const acpQueueAutoDrainInputSchema = acpWorkspaceSchema
  .extend({
    id: z.string().uuid(),
    autoDrain: z.boolean(),
  })
  .strict();
export type AcpQueueAutoDrainInput = z.infer<typeof acpQueueAutoDrainInputSchema>;
export const acpAttachmentReadInputSchema = acpWorkspaceSchema
  .extend({
    id: z.string().uuid(),
    ref: acpAttachmentRefSchema.shape.ref,
    offset: z.number().int().nonnegative().default(0),
    limit: z
      .number()
      .int()
      .positive()
      .max(ACP_ATTACHMENT_READ_CHUNK_BYTES)
      .default(ACP_ATTACHMENT_READ_CHUNK_BYTES),
  })
  .strict();
export type AcpAttachmentReadInput = z.input<typeof acpAttachmentReadInputSchema>;
export const acpAttachmentReadResultSchema = z
  .object({
    dataBase64: z.string().max(Math.ceil(ACP_ATTACHMENT_READ_CHUNK_BYTES / 3) * 4),
    mediaType: z.string().min(1).max(128),
    totalBytes: z.number().int().nonnegative().max(ACP_ATTACHMENT_MAX_BYTES),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type AcpAttachmentReadResult = z.infer<typeof acpAttachmentReadResultSchema>;

export const acpPermissionOptionSchema = z.object({
  optionId: z.string().min(1),
  name: z.string(),
  kind: z.string(),
});

export const acpConfigChoiceSchema = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
});
export const acpConfigOptionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    type: z.literal("select"),
    currentValue: z.string(),
    options: z.array(
      z.union([
        acpConfigChoiceSchema,
        z.object({ group: z.string(), name: z.string(), options: z.array(acpConfigChoiceSchema) }),
      ]),
    ),
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    type: z.literal("boolean"),
    currentValue: z.boolean(),
  }),
]);
export type AcpConfigOption = z.infer<typeof acpConfigOptionSchema>;

export const acpModeStateSchema = z.object({
  currentModeId: z.string(),
  availableModes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
});
export type AcpModeState = z.infer<typeof acpModeStateSchema>;

/** Read-only target-Host catalogs contain capabilities, never source conversation data. */
export const acpAgentConfigSnapshotSchema = z
  .object({
    agent: acpAgentSchema,
    source: z.enum(["workspace", "host"]),
    configOptions: z.array(acpConfigOptionSchema),
    modeState: acpModeStateSchema.nullable(),
  })
  .strict();
export type AcpAgentConfigSnapshot = z.infer<typeof acpAgentConfigSnapshotSchema>;
export const acpAgentConfigCatalogSchema = z
  .array(acpAgentConfigSnapshotSchema)
  .max(ACP_AGENT_CATALOG.length);

export const ACP_TOOL_DETAIL_MAX_CHARS = 64 * 1024;
export const acpToolKindSchema = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);
export const acpStopReasonSchema = z.enum([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);
export type AcpStopReason = z.infer<typeof acpStopReasonSchema>;
export const acpTraceSelectionSchema = z.object({
  name: z.string(),
  value: z.union([z.string(), z.boolean()]),
});

export const acpSessionFailureSchema = z.object({
  id: z.string().min(1).max(512),
  revision: z.number().int().positive(),
  category: z.string().min(1).max(64),
  severity: z.enum(["warning", "error"]),
  title: z.string().min(1).max(32_000),
  details: z.string().max(32_000).optional(),
  actions: z.array(z.string().min(1).max(64)).max(16),
});
export type AcpSessionFailure = z.infer<typeof acpSessionFailureSchema>;

export const acpEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("compaction"),
    status: z.enum(["running", "success", "failed", "cancelled"]),
    origin: z.enum(["manual", "auto"]).optional(),
    tokensBefore: z.number().finite().nonnegative().optional(),
    tokensAfter: z.number().finite().nonnegative().optional(),
    summary: z.string().max(32_000).optional(),
    error: z.string().max(32_000).optional(),
    createdAt: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("thought"),
    text: z.string(),
    state: z.enum(["streaming", "complete", "interrupted"]),
    createdAt: z.number().optional(),
    durationMs: z.number().nonnegative().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("plan"),
    entries: z.array(acpPlanStepSchema),
    createdAt: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("user"),
    text: z.string(),
    createdAt: z.number().optional(),
    /** Host 首次观察到本轮结束的时刻；旧快照缺失时不推测耗时。 */
    endedAt: z.number().finite().nonnegative().optional(),
    attachmentNames: z.array(z.string()).optional(),
    attachments: z.array(acpAttachmentRefSchema).max(8).optional(),
    /** 接纳时的选项与该轮错误属于原会话；后续配置/成功不能覆盖旧轨迹。 */
    traceSelections: z.array(acpTraceSelectionSchema).optional(),
    traceError: z.string().optional(),
    failures: z.array(acpSessionFailureSchema).max(64).optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("assistant"),
    text: z.string(),
    createdAt: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("tool"),
    title: z.string(),
    status: z.string(),
    content: z.string().optional(),
    toolKind: acpToolKindSchema.optional(),
    toolName: z.string().max(256).optional(),
    terminalIds: z.array(z.string().min(1).max(256)).max(64).optional(),
    input: z.string().max(ACP_TOOL_DETAIL_MAX_CHARS).optional(),
    output: z.string().max(ACP_TOOL_DETAIL_MAX_CHARS).optional(),
    inputTruncated: z.boolean().optional(),
    outputTruncated: z.boolean().optional(),
    contentTruncated: z.boolean().optional(),
    createdAt: z.number().optional(),
    workflow: acpWorkflowToolSchema.optional(),
  }),
]);
export type AcpEntry = z.infer<typeof acpEntrySchema>;

export const acpSessionSchema = acpWorkspaceSchema.extend({
  id: z.string().min(1),
  agent: acpAgentSchema,
  createRequestId: z.string().uuid().optional(),
  /** A preconnected draft is neither stored nor offered as historical conversation. */
  provisional: z.boolean().optional(),
  acpSessionId: z.string().min(1),
  status: z.enum(["idle", "running", "interrupted"]),
  revision: z.number().int().nonnegative(),
  /** Frozen filesystem snapshot time for pre-timestamp history; not a message timestamp. */
  legacySavedAt: z.number().int().positive().optional(),
  /** An empty native session that could not be loaded remains readable after replacement. */
  supersededBy: z.string().uuid().optional(),
  title: z.string(),
  /** Sidebar metadata belongs to this Host snapshot; older files use unpinned/read defaults. */
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
  deletionState: z.literal("pending").optional(),
  unreadAt: z.number().int().positive().nullable().default(null),
  goal: z.string().nullable().default(null),
  configOptions: z.array(acpConfigOptionSchema).default([]),
  modeState: acpModeStateSchema.nullable().default(null),
  /** This session's selection, independent of the latest new-session preference. */
  permissionSelection: acpPermissionSelectionSchema.optional(),
  /** Agent-reported current context occupancy; missing legacy snapshots have no known value. */
  contextUsage: z
    .object({ used: z.number().finite().positive(), size: z.number().finite().positive() })
    .nullable()
    .default(null),
  entries: z.array(acpEntrySchema),
  terminals: z.array(acpTerminalSchema).max(128).default([]),
  queue: acpQueueStateSchema.default({ items: [], autoDrain: true }),
  /** 与 API 共用有界投影；旧快照缺席，Host 按 journal 恢复。 */
  workflowRuns: workflowRunsStateSchema.optional(),
  /** Native cumulative facts are separate from per-command accounting. */
  nativeUsage: z
    .object({
      nativeSessionId: z.string().min(1),
      usage: acpTokenUsageSchema,
    })
    .nullable()
    .optional(),
  /** Old snapshots cannot use an unverified cumulative report as a new turn's usage. */
  usageBaselineKnown: z.boolean().default(false),
  usageBaseline: acpTokenUsageSchema.nullable().default(null),
  usageTurns: z.array(acpUsageTurnSchema).default([]),
  pendingPermission: z
    .object({
      requestId: z.string(),
      title: z.string(),
      options: z.array(acpPermissionOptionSchema),
    })
    .nullable(),
  pendingElicitation: acpElicitationSchema.nullable().default(null),
  error: z.string().nullable(),
  /** Scope of the current error; internal prompts cannot fail an unrelated user turn. */
  errorCommandId: z.string().optional(),
});
export type AcpSession = z.infer<typeof acpSessionSchema>;

/** Auxiliary generation never admits input to the source conversation. */
export const acpTextSourceSchema = z
  .object({
    agent: acpAgentSchema,
    modelId: z.string().trim().min(1).max(512),
    modelName: z.string().trim().min(1).max(512),
  })
  .strict();
export type AcpTextSource = z.infer<typeof acpTextSourceSchema>;
export const acpGenerateTextSchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    prompt: z.string().trim().min(1).max(48_000),
  })
  .strict();
export type AcpGenerateText = z.infer<typeof acpGenerateTextSchema>;
export const acpCancelGenerateTextSchema = acpGenerateTextSchema.omit({
  prompt: true,
  expectedRevision: true,
});
export type AcpCancelGenerateText = z.infer<typeof acpCancelGenerateTextSchema>;
export const acpGeneratedTextSchema = z
  .object({
    text: z.string().trim().min(1).max(12_000),
    source: acpTextSourceSchema,
  })
  .strict();
export type AcpGeneratedText = z.infer<typeof acpGeneratedTextSchema>;

/** Host diagnostic facts; details are referenced by immutable snapshot row indexes, never logged. */
export const acpDiagnosticEventSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  eventId: z.string().uuid().optional(),
  turnIndex: z.number().int().nonnegative().optional(),
  entryIndex: z.number().int().nonnegative().optional(),
  requestId: z.string().uuid().optional(),
  permissionDecision: z
    .enum(["allow_once", "allow_always", "reject_once", "reject_always", "cancelled", "unknown"])
    .optional(),
  stopReason: acpStopReasonSchema.optional(),
  kind: z.enum([
    "prompt-accepted",
    "tool-update",
    "permission-requested",
    "permission-resolved",
    "elicitation-requested",
    "elicitation-resolved",
    "turn-completed",
    "turn-interrupted",
    "turn-stopped",
    "adapter-exited",
    "trace-truncated",
  ]),
  status: z.enum(["pending", "in_progress", "completed", "failed", "unknown"]).optional(),
});
export type AcpDiagnosticEvent = z.infer<typeof acpDiagnosticEventSchema>;
export const acpExecutionTraceChangedSchema = acpWorkspaceSchema
  .extend({
    id: z.string().uuid(),
    event: acpDiagnosticEventSchema,
  })
  .strict();
export type AcpExecutionTraceChanged = z.infer<typeof acpExecutionTraceChangedSchema>;

export const acpSessionRowUpdateSchema = acpWorkspaceSchema
  .extend({
    id: z.string().uuid(),
    action: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("pin"), pinned: z.boolean() }).strict(),
      z.object({ kind: z.literal("archive"), archived: z.boolean() }).strict(),
      z.object({ kind: z.literal("rename"), title: z.string().max(200) }).strict(),
      z
        .object({
          kind: z.literal("unread"),
          unread: z.boolean(),
          /** 只清除用户实际看到的结果，迟到请求不能清掉下一轮完成标记。 */
          expectedUnreadAt: z.number().int().positive().optional(),
        })
        .strict(),
    ]),
  })
  .strict();
export type AcpSessionRowUpdate = z.infer<typeof acpSessionRowUpdateSchema>;

/** 已接受消息的时间是活动事实；查看、配置和快照 revision 不改变排序。 */
export function acpSessionActivity(
  session: Pick<AcpSession, "entries" | "legacySavedAt"> & Partial<Pick<AcpSession, "queue">>,
) {
  if ("history" in session) {
    const history = session.history as { createdAt: number; updatedAt: number };
    return { createdAt: history.createdAt, updatedAt: history.updatedAt };
  }
  const times = session.entries
    .map((entry) => entry.createdAt)
    .filter((value): value is number => typeof value === "number")
    .concat(session.queue?.items.map((item) => item.createdAt) ?? [])
    .sort((a, b) => a - b);
  return {
    createdAt: session.legacySavedAt ?? times[0] ?? 0,
    updatedAt: times.at(-1) ?? session.legacySavedAt ?? 0,
  };
}

export function isAcpHistorySession(session: AcpSession): boolean {
  return (
    !session.provisional &&
    !session.supersededBy &&
    (session.entries.some((entry) => entry.kind === "user") || Boolean(session.queue?.items.length))
  );
}

export const acpSessionSearchInputSchema = acpWorkspaceSchema
  .extend({
    query: z.string().max(4096).optional(),
    limit: z.number().int().min(1).max(80).optional(),
  })
  .strict();
export type AcpSessionSearchInput = z.infer<typeof acpSessionSearchInputSchema>;

export const acpSessionSearchItemSchema = acpWorkspaceSchema
  .extend({
    id: z.string().min(1),
    agent: acpAgentSchema,
    title: z.string(),
    status: acpSessionSchema.shape.status,
    revision: z.number().int().nonnegative(),
    createdAt: z.number(),
    updatedAt: z.number(),
    matches: z
      .array(
        z
          .object({
            entryId: z.string(),
            snippet: z.string().max(220),
            rowId: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type AcpSessionSearchItem = z.infer<typeof acpSessionSearchItemSchema>;
export const acpSessionSearchResultSchema = z.array(acpSessionSearchItemSchema).max(80);

/** 仅实时通知的取证元数据，不进入 AcpSession 或持久化历史。 */
export const acpStreamDiagnosticSchema = z
  .object({
    receivedRevision: z.number().int().nonnegative(),
    receivedAt: z.number().finite().nonnegative(),
    snapshotStartedAt: z.number().finite().nonnegative(),
    broadcastAt: z.number().finite().nonnegative(),
    kind: z.enum(["text", "thought", "compaction_summary"]),
    chunkChars: z.number().int().nonnegative(),
    entryIndex: z.number().int().nonnegative(),
    entryCount: z.number().int().nonnegative(),
  })
  .strict();
export type AcpStreamDiagnostic = z.infer<typeof acpStreamDiagnosticSchema>;

export const acpSessionChangedSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("updated"),
    session: acpSessionSchema,
    streamDiagnostics: acpStreamDiagnosticSchema.optional(),
  }),
  z.object({
    kind: z.literal("removed"),
    id: z.string(),
    workspaceKey: z.string(),
    workspacePath: z.string(),
    remoteSessionId: z.string().optional(),
  }),
]);
export type AcpSessionChanged = z.infer<typeof acpSessionChangedSchema>;
