# ACP 会话的 ZCode 插件能力

## 产品规则与边界

- 目标 Host 的 `IAcpService` 是 ACP 插件可用性、连接快照及提问接纳的所有者。插件安装、启停、变量展开和 MCP 命名由目标 Host 的 ZCode CLI 插件加载器负责，不在 Renderer 重做解析。ACP 的 **+ → 插件** 只从目标 Host 获取已安装、已启用、无同名冲突且至少贡献可用技能或可由 ACP 表达的 MCP 的插件；不可用的组件不得作为可点击能力展示。尚未连接时只提供启用技能及通过本机命令检查的 stdio MCP；HTTP/SSE 在 Agent 握手确认 transport 后显示，打开菜单不创建 Agent 会话或触发登录。
- 启用插件的普通 stdio/HTTP/SSE MCP 由目标 Host 在 ACP `session/new`/`session/load` 传入。插件身份、配置和环境在连接启动时冻结；stdio 命令按插件目录/目标 Host 的 PATH 解析，HTTP/SSE 需 Agent 声明 transport capability。OAuth、官方身份、CUA broker 等 ZCode 专属能力不转发凭据、不伪装为普通 MCP；插件仅有这些组件时标记不可用。普通设置中的 MCP 仍保留其原有严格失败语义，插件单项不兼容不能阻断整个 ACP 会话。
- 点击插件生成已有 canonical `[@名称](plugin://stable-id)` 引用。Host 在每次提问接纳前重新核对插件稳定 ID、启用态、冲突和该连接实际供应的 MCP；只注入已启用插件的技能说明及可用工具名称，不凭展示 label 猜身份。被卸载/停用/冲突或目标 Agent 不支持的引用在接纳前报错，保留草稿与附件。历史用户原文仍保存，注入的正文、凭据、环境变量不进入会话快照/诊断。
- 插件技能仍可通过 `$技能名` 独立引用。插件 MCP 通过 ACP Agent 现有的 MCP 工具调用及其 `session/request_permission`、tool update、cancel 生命周期执行。ZCode 专用命令、hooks、subagent 和 CUA broker 需要单独桥接；只包含这些组件的插件在 ACP 菜单不冒充可用。切回 API/ZCode 后保持原有 session-owned 插件 catalog 和 CLI `plugin://` 提醒语义。
- `plugin://` 的 stable-id 校验、大小写、转义、去重和单轮数量上限与 API/ZCode 共用 `@zcode/shared` 的解析器。裸 URL 或普通说明文字不激活插件；canonical 引用无效或超量时在接纳前拒绝。含凭据的 CLI snapshot 仅经 Host 内部读取器获取，不向公共 RPC service 注册读取方法。

## 状态所有者和顺序

```text
插件安装/启停/配置 (CLI) → 目标 Host ACP 插件快照 → Agent initialize/capabilities
                                    │                        ↓
                                    └────── 可投影 MCP → session/new 或 session/load
用户从 + 选择 plugin://stable-id → Host 重新验证启用态和当前连接供应
                                    → commandId 接纳 → ACP session/prompt
                                    → Agent MCP 工具/权限更新 → Host snapshot + desktop live/mobile replay
```

- `workspaceIdentity?.trim() || workspacePath` 决定 Host 会话和异步请求身份；目标 Host 的 `workspacePath` 负责本地插件和 MCP 解析。菜单晚到的旧 workspace/远程 attachment 结果不能回填。插件 MCP 配置在当前连接冻结，安装/启停/配置更新在新连接或重新打开会话后生效；禁用引用在下一次接纳时立即拒绝。不能在运行中的会话替换工具集合。重试复用 commandId，旧连接 generation 不能写回新的工具结果。
- `desktop-continuous` 直接收到既有会话的工具/权限事件；手机 `web-remote-replayable` 使用同一 Host 快照和补播，不启动独立插件执行器。连接变化只在新连接生效，活动回合不中断。

## 验收

1. 安装并启用提供普通 stdio MCP 和技能的插件；Desktop 与 375px 手机 Web 的 ACP **+** 列出它，点击后插入 canonical 引用，发送后 Agent 在 `session/new`/`session/load` 收到带命名空间的 MCP，提问仅附该插件的已启用技能信息，原文持久化。
2. 禁用、卸载或制造同名冲突后重开菜单不提供该能力；已写入草稿的引用发送前被 Host 拒绝且不会创建用户行。重新启用后新连接可恢复；API/ZCode 原有插件引用照旧。
3. 含 OAuth/官方凭据/CUA 或 Agent 不支持 transport 的插件 MCP 不泄漏凭据；兼容的其他插件仍可用，只有不可投影组件的插件不被错误标为可用。设置中的普通 MCP 继续按其既有失败规则提示。
4. 测试 idempotent prompt、重连、权限结果、跨 workspace/远程 Host 隔离及旧流回填；源码级 mock 与 fake ACP wire 不能代替真实插件 + 真实 Agent 的手工验证。
