# 跨智能体委派

## 范围与产品规则

- API 与 ACP 主会话均可通过 `zcode-delegation` MCP 委派已安装、启用的 ACP 智能体，以及模型设置中已进入执行 Registry 的 API 模型。API 内置 Agent/subagent 不变，不替换模型选择器、不新建聊天页面。
- `@智能体` 插入明确的委派引用，不切换主会话、不预连接、不在选择时登录。自然语言由主智能体使用相同工具处理。
- 显式传递任务、背景、项目文件、附件、约束与预期输出，不复制完整父历史、私有推理或凭据。附件须为 ZCode 已管理的引用。
- `analysis` 使用原项目目录；`edit` 默认分配配置目录下的独立工作树。分析是任务意图，不是假冒的操作系统只读沙箱。保留智能体原有权限检查。
- 独立任务可并行，依赖任务只在前置任务成功后开始；默认同项目最多两个执行。共享同一子会话的任务串行。
- 可调度任务按数据库持久化入队顺序分配执行位，不用同毫秒可能乱序的 UUID 排序；Host 重复关闭只执行一次收尾，不重新打开数据库。
- 开启嵌套时最大深度不能超过并发数；调度器为每个更深层级保留一个执行位，避免所有父任务等待子任务却占满容量。默认不启用嵌套。
- 最大委派层级支持 1–8 层，与 Codeg 当前的设置范围一致；主会话不计层级，直接子任务为第 1 层。关闭嵌套时只允许第 1 层；不改变旧配置字段、默认值或已保存的层级偏好。
- 委派设置参考 Codeg 的「多智能体协同」通用设置：主开关「启用委托」、最大委托深度、已完成结果缓存（MB），保留 ZCode 的项目并行任务限制。设置导航在「Agent 能力」分组增加独立的「多智能体协同」菜单（`delegation`），不再放在 Agent SDK 管理页内；沿用现有设置页的标题、主题、字号及紧凑设置行。
- 导航分区偏好和一次性跳转意图使用现有 `settingsNavigation`；菜单在 Desktop 和 Web 均可见。页面复用 `DelegationSettings` / `useDelegationSettings`，继续传递当前 workspacePath、workspaceIdentity、remoteSessionId 与服务目标。作用域、远程连接及就绪状态改变时重置本地输入草稿，不复用上一目标的草稿。
- 迁移只改变 UI 入口，不新增设置所有者、服务命令或持久化路径，不迁移或重置既有深度、缓存、并发和开关。切换分区后重新读取原服务的权威配置，失焦自动保存与失败回退不变；禁用提示指向「设置 → 多智能体协同」，SDK 页只负责智能体安装、版本及认证管理。
- `enabled` 为委派主开关。缺失时默认开启，兼容旧版本一直提供委派的行为；关闭后新建/恢复的主会话不提供委派 MCP，子会话仍提供结果回传工具。旧连接不强制重连，其新委派、追问、重试与恢复由服务端立即拒绝；查询、取消、结果回传和已接受任务继续执行，不因设置改变丢失历史或幂等回执。
- 深度输入始终显示，开启委托后可直接设置 1–8；1 只允许直接子任务，大于 1 允许继续委托，不另设嵌套开关。读取旧 `allowNested=false` 配置显示有效深度 1，保留原持久化字段；主动修改深度时同步 `allowNested`，关闭主开关不改变深度偏好。数值输入失焦自动保存，无保存按钮；空值、非整数及超出范围的值恢复已保存值，不发送无效设置。
- `completedCacheMaxMb` 默认 512 MB，0 表示不限额，非负整数且不超过 uint32 范围。缓存是 Repository 对持久已完成任务快照的派生投影，以序列化快照 UTF-8 字节数计算预算（不是进程总内存上限），按根主会话隔离，超预算移除最早缓存；超大单条记录可直接读库。缓存清理绝不删除 SQLite 结果、通知或子会话。停止/删除主会话、Host 关闭清理对应缓存，暂停主会话不再填充；调低预算即时清理本 Host，其他 Host 下次读取时遵守新预算。
- 缓存每次读取先取得 SQLite 的权威序列化记录，以完整记录版本匹配避免跨 Host 或事务回滚返回旧数据。缓存返回独立副本，调用方修改不能污染缓存或落盘事实。旧客户端缺少新增字段的设置写入保留数据库中的主开关和预算，不重置用户选择。
- UI 在原有串行设置写入路径中协调层级与并发：提高层级至超过并发数时，同一次保存提高并发数；降低并发数至小于已启用的层级时，同一次保存降低层级。开启嵌套也协调所需并发数；服务端继续严格拒绝不满足容量约束的外部设置。
- 降低层级、并发数或关闭嵌套不取消已接受的任务。新任务 admission 使用最新设置；调度容量及预留层级由最新设置和同项目尚未结束的已接受任务共同推导，保证旧链条的下级任务不被等待中的父任务堵住，链条结束后恢复配置上限。不会自动重新连接或给已连接的智能体强行更新工具目录；新建/恢复子会话时按最新层级决定是否提供继续委派工具。
- follow-up 创建新任务并复用子会话；retry 重试失败任务；resume 明确恢复中断任务。三者与执行 attempt 分开记录，已完成结果不可被 follow-up 覆盖。
- requestId 幂等检查优先于目标可用性和附件检查；已接收请求重试不因设置变化而拒绝。follow-up 的新任务、旧会话及工作树绑定在同一个事务内写入。
- 已结束任务持久化结论、修改文件、测试、风险与阻塞信息。优先使用子智能体的结构化结果工具，未调用时保留最后实际回答并标明非结构化结果，不能编造测试通过。
- 结果回到发起会话；父会话忙时保持 durable outbox。API 通过既有 CommandInbox 串行 admission；ACP 只在已有连接空闲时提交。自动消息仅要求汇总，不授权继续修改、合并、提交或推送。
- 停止/删除父会话时停止所属委派并抑制结果回传；迟到结果受 attempt/owner/generation fence 限制。新用户输入可重新启用父会话委派。
- 取消单个委派时递归停止其下级任务，抑制下级各次执行尚未回传的结果；已完成结论与历史仍保留，不影响同父会话的其他委派。
- API stop 在 Runtime 验证前台执行身份后通过反向协议暂停委派；过期 Stop 的 `guard.stopTargetChanged` 不改变委派状态。条件关闭未匹配 persistence 时同样不暂停。
- 不删除工作树或子历史作为取消副作用。用户可在原有工作树与会话界面管理它们。

## 唯一所有者与事件顺序

`AgentDelegationService` 是任务、attempt、依赖、设置及通知 outbox 的唯一写入所有者。SQLite 事务协调窗口内各 Host，owner/lease 防止重复执行；UI 只读 projection 并发出命令。

```text
API / ACP 主智能体 ─ MCP capability ─┐
现有聊天 @智能体 / 委派操作 ────────┼→ DelegationService → SQLite task / attempt / outbox
                                    │       ↓ 事务 claim + lease + commandId
                                    │   工作树准备 → 现有 API / ACP 会话执行器 → 权限 / usage
                                    │       ↓ fenced complete
                                    └← 原会话 summary ← outbox admission receipt
```

- workspace key = `workspaceIdentity?.trim() || workspacePath`；parent kind/id 共同隔离。文件操作只使用 workspacePath。
- claim 先落盘，再创建工作树/会话；绑定先落盘，再 prompt。每次 attempt 独立 commandId；commit 必须匹配 owner/attempt。
- 依赖、复用会话绑定只接受同一 parent scope 的任务。默认不允许嵌套；打开嵌套时仍限制深度、拒绝循环依赖与跨父会话复用。
- outbox 先持久化 sending，再提交原会话；正常 admission 后标记 delivered。发生不确定断连时标记 uncertain，重启不自动重放。可由用户显式重新回传。
- 未过期 lease 不能被另一 Host 抢占；过期 preparing/running/awaiting_input 标记 interrupted，不自动 replay writes。queued 尚未执行的任务可继续调度。
- ACP 无 loadSession 时沿用现有连接恢复失败语义，不伪装恢复成功。无 MCP capability 的智能体仍可由界面手动委派，但不能宣称支持自然语言工具调用。

## 平台与持久化边界

- 委派 MCP 的 JSON Schema 正则须能被外部模型服务校验。附件名称的 NUL 禁止规则使用跨引擎兼容的 `\x00`，不输出 `\0`；`DelegateTask` 与 `FollowUpDelegation` 继续复用共享附件协议，Host 仍拒绝空名称、超长名称、NUL、回车和换行，不通过移除校验来兼容供应商。
- schema 由共享协议定义，经 `delegationMcp` 的既有 `z.toJSONSchema` 和 MCP `tools/list` 发送给 API/ACP；不新增供应商分支、状态所有者或写入路径，不改变 Desktop continuous / Mobile replayable 的消息和恢复语义。该修复不迁移数据，新建或重新连接 Agent 后加载新工具目录。
- 初版执行本地项目，远程 workspace 必须明确拒绝本地执行，绝不把远程路径当本地 cwd。移动端连接桌面已有 Host 读取同一服务，不启动新运行时。
- desktop-continuous 复用实时会话 stream；web-remote-replayable 复用快照与断档恢复。委派列表事件仅作失效通知，重连读取持久化 list，不承载第二份任务队列。
- MCP 复用现有 Host loopback capability bridge，工具 metadata 参数化；调用并发避免 wait 阻塞 cancel。token 仅存在 Host 内存及启动环境，不写 task/session 快照。
- 子会话的 SubmitDelegationResult 必须携带本轮 commandId；同一会话追问可复用连接，但上一轮迟到结果不能覆盖新的 attempt。取消或 lease 过期后不能提交结果。
- API 在 runtime create/resume 时通过严格校验的反向协议请求获得 MCP；旧 Host 返回 unsupported 时 fail closed，既有 API 对话不受影响。
- API 委派 MCP 是临时 Host overlay，不替换原有用户、项目、插件和内置 MCP。未成功 provision 的 ACP MCP 不向智能体宣称可用。
- 不迁移既有 WorkTask 状态，不修改原统计来源；子 API / ACP 会话继续通过原统计 owner 记录用量。

## API 委派目标

### 委派引用的发送前后展示（#170）

- 输入框与发送后的用户消息复用现有 subagents chip：相同的 Bot 图标、16px 图标尺寸、1.5 描边及 `text-subagent-node-foreground` 语义颜色；候选列表的 ACP/API 品牌图标不改变 chip 的展示规则。
- 标签规范化由 UI 的 `normalizePromptMentionDisplayLabel` 统一持有，不新增状态、目录请求或持久化元数据。已知 `acp.<agent>` 使用现有 ACP catalog 的可读名称（例如 `DeepSeek Harness`），输入框、发送后及旧消息回放保持一致。
- API 的 canonical 链接继续保留完整 model/provider 身份和原可读标签；UI 解析结果保留 reference，仅供展示判别，不从模型名称猜 ACP 身份，不改变消息协议、发送文本或委派执行。
- 缺失目录元数据的旧消息仍能按已知 ACP reference 展示名称；未知 ACP、普通 `@name` 和缺失/非法身份保持原标签与通用 Bot，不请求配置、不抛错。输入框恢复旧草稿遵守同一规则。
- 验收：选择 ACP/API 候选后实际提交，气泡与输入框的标签、图标和语义颜色一致；API 中文、斜杠和同名不同 provider 标签保留；未知旧引用安全降级。1280px/375px、Zai Light/Dark 均不溢出，canonical 发送文本保持不变。

- API 目标只读取 Host 的 `IModelSelectionService` 已应用 Registry，不从 Renderer 偏好、设置草稿或历史会话拼出候选；不调用连通性测试，不读取/发送 API key。禁用、隐藏、配置无效或尚未发布的模型不出现在委派列表。
- 公共 targets 返回经过运行时校验的 API / ACP 联合投影。API 携带 provider 名称、完整 modelSelection 与可用 reasoningLevel 档位，首次选择沿用既有 `completeNewModelSelection` 规则；服务端 admission 再次检查 provider/model 身份和档位，Runtime 保持最终执行校验。
- API 引用身份为 `api.<providerId 的 UTF-8 hex>.<modelId 的 UTF-8 hex>`；同名模型按 provider 区分，中文、空格及斜杠不丢失或发生替换碰撞。输入框和消息展示可读模型名与 provider；MCP 的 ListDelegationAgents 返回相同 reference 与执行参数供主智能体使用。已有 `@acp.<agent>` 继续有效。
- `@` 和手动委派弹窗使用同一目标源；选择 API 不切换主智能体、不启动连接、不创建任务。只在用户提交委派或主智能体调用 DelegateTask 时走既有 admission、调度、attempt、子会话绑定和 outbox。
- API 子会话使用现有 ZCode / WorkTask API 执行器，保留 mode、完整模型选择、附件、独立工作树、权限和用量。显式 workspaceFiles 的项目相对路径写入委派提示，供子智能体在分配的 cwd 读取；不为 API 发明独立文件上传协议。follow-up 复用同一个子会话，结果仍按每次 commandId 独立归档。
- API 创建 commandId 使用已持久化的 sessionRequestId。CLI 在 createRecord 请求委派 MCP 时透传该创建 ID；Host 在 create ACK / session binding 之前即可沿用 ACP 的 requestId 绑定识别子任务，默认只提供 SubmitDelegationResult，嵌套工具仍受根设置限制。创建 ID 仅作为瞬态请求关联，不写入旧会话 schema，不另建待创建队列；已有会话恢复按 kind/sessionId 绑定。新增反向协议字段为可选，旧 Host 严格拒绝新字段时沿用无委派工具的 fail-closed 行为。
- API 非结构化结果从 V4 的权威行分页读取：只选择本次 commandId 所属 turn 的最后完整 assistantText，不读取 reasoning、工具输出、旧追问或其他用户轮次；跨分页 revision/epoch 改变时拒绝拼接。结构化 SubmitDelegationResult 的 attempt fence 与优先级不变。
- 不更改旧数据库格式；现有 execution 联合协议已支持 API。旧 Host 的 ACP-only targets 在新 UI 中按 ACP 解析；未提供 API 目录时不凭空构造目标。远程执行限制保持不变。

```text
DelegationService 落盘 sessionRequestId
  → WorkTask createSession(commandId=sessionRequestId)
  → CLI createRecord 反向请求 MCP(sessionId, createRequestId)
  → Host 按 execution kind / cwd / createRequestId 识别子任务并 provision 工具
  → create ACK → DelegationService 落盘 session binding → sendText
```

```text
设置数值失焦 / 委托主开关
  → useDelegationSettings 串行合并最新设置并协调层级 / 并发
  → AgentDelegationService 严格校验 → 原 SQLite 配置
  → 新委派 admission 校验当前层级；新建 / 恢复子会话按层级提供 MCP 工具
  → 调度器从配置 + 已接受的未结束任务推导容量 → 旧链条完成后回落
```

```text
设置菜单 / 既有导航意图 → SettingsPage（仅持有分区偏好）
  → 多智能体协同分区（目标变化重挂载输入草稿）
  → useDelegationSettings → 原 DelegationService / SQLite 配置
  ← 读取 / 保存回执；切回分区重新读取，不另建设置状态或写入路径
```

## 接口与界面

- 服务：list、targets、delegate、followUp、retry、resume、cancel、cancelAll、redeliver、get/updateSettings、onDynamicChanged。
- MCP：ListDelegationAgents、DelegateTask、GetDelegationTask、ListDelegationTasks、WaitDelegationTask、FollowUpDelegation、RetryDelegation、ResumeDelegation、CancelDelegation、CancelAllDelegations；子会话 SubmitDelegationResult。
- 委派任务显示在发起它的对话轮次的工作内容中，摘要行位于该轮最终回复之前，沿用 API 内置 Agent 的紧凑工具行视觉层级，显示目标图标、标题和实时状态；展开后保留打开原子会话、取消/重试/恢复/追问、各次执行的完整结果与回传状态。手动委派和追问复用既有聊天输入及附件上传；设置通过独立的「多智能体协同」菜单进入，不新增对话页。
- 子会话保留完整历史，但普通 API/ACP 会话列表、全文搜索、置顶、归档、工作区分组和工作树会话列表不显示委派子会话；它只能经所属委派任务的「打开子会话」显式进入。导航和精确 ID 读取不受列表排除影响。普通会话与 API 内置 Agent 不受影响。
- 子会话归属以 DelegationRepository 中按子会话实际 workspace identity/path、kind 和 session ID 持久化的绑定为准；隔离工作树使用工作树路径的 fallback key。绑定在执行器确认创建会话时随任务状态同一事务记录，follow-up 复用，retry 新建时不删除旧绑定，resume 沿用当前绑定；启动时从旧任务当前绑定补齐历史。旧版本在重试时已丢弃的绑定无法从现存任务恢复，不按标题或目录猜测。会话创建到绑定确认之间，历史投影不得短暂显示子会话；API 的 deferred 持久化和 ACP 的历史资格判定保持此事件顺序。
- 普通列表的排除发生在各自的权威读取/搜索投影中，分页、total 和 hasMore 在排除后计算；ACP 的内部精确读取与执行校验继续可访问子会话。归属读取失败不得把已知隐藏子会话作为普通会话显示。不同 workspace identity 即使路径或会话 ID 相同也不能互相过滤。

```text
DelegateTask → DelegationRepository 接受任务 → 执行器创建 API/ACP 会话
  → 同一事务提交 session 绑定和隐藏归属 → 普通列表/搜索排除
  └→ 父会话委派行 → 按精确 ID 打开子会话
retry → 新 session 绑定追加；旧绑定保留
```

- UI 只用持久任务的 `createdAt` 与 CLI/ACP 投影的轮次 `startedAt` 定位原轮次，以下一轮开始或已知 `endedAt` 为排他的结束边界；同一轮多个任务保持服务列表顺序，后续轮次、任务状态更新和历史分页不改变归属。无法可靠定位到已加载轮次的任务仍留在折叠的会话级列表，不能强行归到最新轮。编辑弹窗保持会话级挂载，避免虚拟滚动卸载轮次时丢失草稿。任务事实仍由 `AgentDelegationService` 持有，Renderer 只作投影，不能据 UI 时间推断 admission、完成或回传。
- `@` 智能体候选行显示对应图标：ACP 复用 `AcpAgentIcon` 的品牌素材，API 复用 `TaskAgentIcon` 按当前 Host 的 providerId 读取模型设置中的 logo，不根据模型展示名猜测供应商。图标缺失或加载失败沿用既有默认图标；不新增图标状态、配置读取或网络请求路径。
- 图标为纯展示，候选、选中引用及发送的 canonical 身份保持不变。候选行保留固定 16px 图标区域，在窄屏、亮暗主题和键盘选中时不挤压名称或描述。
- 普通对话没有委派任务时不渲染委派列表，不保留标题、分隔线或空白占位。API 与 ACP 的手动入口统一放在主输入框的 `+` 菜单；新建草稿、只读视图及不支持执行的远程项目不提供该入口。
- 从 `+` 菜单打开现有委派编辑器的弹窗，追问也复用该弹窗。打开、取消和提交不修改主输入框的内容、附件或当前智能体；弹窗关闭不在对话中留下空栏。
- `useAgentDelegation` 是会话范围内委派编辑状态与服务投影的唯一 UI 所有者，菜单只发起打开命令，列表不另建订阅或编辑草稿。workspace identity、主会话类型/ID 或服务所有者改变后，旧弹窗及错误不得出现在新会话；菜单关闭将焦点交给弹窗，不抢回输入框。
- 委派编辑状态仅为 Renderer 草稿，不构成服务端接受队列。提交仍复用现有 delegate/followUp 命令；任务与进度的唯一事实来源仍是 `AgentDelegationService`。自然语言/MCP 委派与桌面、移动端原有投递语义不变。
- 委派自身错误使用委派翻译，复用执行器返回的工作树/会话错误沿用既有 `workTasks.error` 翻译；原始错误码保留在服务记录中。

## 验收

1. fake Codex/Claude ACP 主会话与 API reverse bridge 实际列出并调用委派工具；禁用/未安装目标不可选，选择不启动。
2. 同项目并发上限、依赖串行、同子会话互斥；跟进新任务保留旧结果与 session binding。
3. 任务/attempt/outbox 持久化；跨 owner 不重复 claim；重启将失联执行标记 interrupted，不重放。
4. 取消单任务/全部/父会话 stop 后，迟到完成不改变 canceled 状态，不发起父新轮次。
5. 父忙时 outbox 保留，空闲后只发送一次；API 固定 commandId，ACP 保持已有连接，不隐式重新认证。
6. scope identity、taskId 与 capability token 隔离；跨会话查询/取消拒绝，远程执行拒绝。
7. edit 使用原配置目录与已持久化 worktree；analysis 不创建工作树。结果、权限与用量进入现有会话机制。
8. 浏览器 fake Host E2E 验证 API/ACP 共用列表、操作、@选择、桌面/移动端无溢出。执行 root typecheck/lint 与架构检查，真实付费 Agent 调用不作为自动测试前置条件。
9. 1280px/375px 下，API/ACP 空委派列表不占位；主输入框 `+` 菜单可打开、取消与提交委派弹窗，附件和文件引用仍有效，主草稿保持不变。有任务后显示进度/结果及既有操作；打开弹窗后切换会话不能遗留旧表单或跨会话提交。
10. API/ACP 主会话均可 @ API 模型或在弹窗中选择 API；provider 同名模型可区分、特殊字符身份可往返，选择前后主模型/会话/草稿不变。禁用 API 模型不可委派，已接受 requestId 在设置改变后仍幂等。
11. fake API 执行验证实际 createSession/sendText 的模型选择、mode、附件与绑定；匹配轮次完成后读取本轮回答，超过一页、旧回答、新用户轮、reasoning 和缺少本轮文本均不能误归档，追问保留先前结果。
12. API 子会话在保存 session ID 前，用创建 commandId 经真实 stdio reverse request 取得子任务 MCP，只含结果回传工具；开启嵌套后按深度提供工具。创建身份不能匹配不同 execution kind 或不同工作目录，旧反向请求仍兼容。
13. 1280px/375px 下的 `@` 菜单显示 Codex、Claude 的正确品牌图标；同名 API 模型按各自 provider 配置显示不同图标，素材可解码且图标区域为 16px。选择及发送仍保留 API/ACP 原有身份，不创建或切换主会话；既有图标亮暗主题与 Host 隔离回归通过。
14. 1280px/375px 下深度输入始终可见，关闭委托时禁用但保留原有效深度，开启后可直接失焦保存 1–8 层；提升层级、降低并发及快速连续操作原子协调保存，重新挂载保留配置，非法输入及保存失败恢复权威值。
15. fake API/ACP 混合链条可运行到第 8 层，第 9 层必须拒绝；中间子会话可获委派工具，达到上限的子会话只获结果回传工具。设置持久化且按 workspace identity 隔离；链条执行中降低限制时，已接受的下级仍可启动，新超限请求仍被拒绝，不调用真实模型。
16. 主开关、直接深度、缓存预算与并发在 1280px/375px、亮暗主题下可用且无溢出；0 MB 可保存，清空、负数、小数或超范围预算不得误设不限额。连续失焦/开关写入、失败回退、重新挂载及旧设置读取仍正确。
17. API/ACP 新注册 MCP 在关闭时隐藏委派工具，已连接能力不能绕过最新 admission；已接受请求仍幂等，queued/running 不取消，SubmitDelegationResult 和查询/取消保留。关闭后新追问、重试、恢复拒绝，重新启用恢复入口。
18. 缓存预算按根主会话隔离；默认/不限额、超预算淘汰、超大记录、停止及关闭清理、设置降低、跨 Host 写入/暂停、事务回滚和返回副本测试通过，持久结果与 outbox 不丢失。
19. Desktop / Web 设置导航的「Agent 能力」分组均有且只有一个「多智能体协同」入口；SDK 管理页不再挂载委派设置。1280px / 375px 下菜单可打开对应分区，页标题不重复，切到 SDK 页再返回保留原保存值；重新打开设置记住分区，显式导航意图仍优先且只消费一次。中英文禁用提示指向新入口，原自动保存和失败回退回归通过。
20. API/ACP 发起轮中的委派任务在该轮以 Agent 同级的摘要行展示；下一轮到来与任务完成不移动原行，展开可查看结果与操作。历史未加载、轮次无有效时间或时间冲突时仍能从会话级列表访问，不重复显示；1280px/375px、亮暗主题下无溢出，切换会话不残留旧任务或编辑草稿。
21. API/ACP 各创建一个普通会话和一个委派子会话；侧栏 timeline、工作区分组、搜索/最近、置顶/归档及工作树设置只列出普通会话，数量与分页正确，委派行仍可打开并读取子会话。重启后保持；follow-up 不新建，retry 后旧/新子会话都不进入普通列表；同路径不同 identity 不串隐藏。订阅早于历史列表、创建 ACK 早于绑定、旧读取迟到和归属服务错误不闪现隐藏行。

22. API/ACP 主会话的真实 MCP `tools/list` 中，`DelegateTask` 和 `FollowUpDelegation` 的附件名称正则不包含 `\0`；导出的正则与 Host 校验均接受普通中英文文件名，拒绝 NUL、回车和换行，保留长度限制及其他字段约束。

## 本地验证记录

- 2026-10-17，issue #188：确认 `DelegateTask.attachments[].fileName` 导出的 `\0` 与截图中的非法正则一致，改为等价的 `\x00`。API/ACP 真实 MCP 目录新增 2 项回归先失败、修复后通过；委派/MCP/stdio/附件联跑 13 项通过、1 项 ACP 回传 `uncertain` 超时，恢复修改前的共享协议后单独复跑仍同样失败。补齐本工作树 workflow 构建产物后，Node 24.14.0 的 root typecheck 通过，Lint 73 warning、0 error，架构 0 baseline/0 new violation，相关格式与 diff 检查通过；未调用真实 DeepSeek 模型，未构建或替换桌面应用。

- 2026-10-14，子会话普通列表归属：委派绑定、API 索引分页与 identity 隔离、ACP 纯投影、工作树列表及失败闭合回归 16/16 通过；1280px/375px 委派面板 E2E 通过，覆盖从委派行打开子会话。根 lint 0 error（74 个已有 warning），架构检查 0 violation，UI 独立类型检查通过。根类型检查及 ACP 服务级测试被当前检出缺失的 `@zcode/dynamic-workflow` 构建产物阻断；未调用真实模型或重启桌面 Host，运行时侧栏效果待装载新 Host 后验证。
- 2026-10-07，Node 24.14.0：委派、ACP、工作流、附件、工作树、API 执行与 Runtime stop 联跑 88/88 通过。委派专项涵盖 MCP capability、跨窗口 lease、各次 attempt 回传、嵌套容量与取消、入队顺序和重复关闭。
- `node packages/ui/test/agentDelegation.e2e.mjs`：1280px/375px 下共用列表、操作、附件/文件引用、@选择及自动保存通过；无页面异常与横向溢出。使用 fake Host，不启动真实模型。
- 根 `pnpm typecheck` 与 Bootstrap typecheck 通过；CLI 15 个包通过 `pnpm -r --filter './apps/zcode-cli/packages/*' typecheck`。
- 根 `pnpm lint`：72 个已有 warning、0 error。CLI 总 typecheck/lint 入口因缺少 `turbo` 未完成；递归 lint 遇到根配置排除 CLI。显式继承配置检查改动文件时，`app/types.ts` 和 `zcode-protocol/v4-bridge.ts` 仍有已有的超 400 行错误，未为本功能放宽规则或重构无关文件。
- CLI 构建及桌面 Agent 构建、暂存通过。架构检查 0 violation，功能图 54 个唯一节点、88 条边及 4 个新委派节点的源码符号验证通过。
- 范围：验证使用真实 stdio/MCP 协议、SQLite 与临时 Git 工作树，但没有调用真实付费模型；远程 workspace 执行仍明确不支持。Windows/Linux 未做实机验证，沿用既有平台适配器。Host/CLI 能力更新需重启桌面应用后加载，纯 Renderer 改动可热更新。
- 2026-10-07，委派入口收敛：同一 fake Host E2E 在 1280px/375px 连续两次通过，覆盖 API/ACP 空列表不占位、草稿/只读无入口、`+` 菜单鼠标及键盘操作、弹窗焦点、失败与成功提交、附件/文件、主草稿保留、会话切换与旧请求迟到隔离；原有任务操作、@选择及设置自动保存仍通过。
- 本轮根 `pnpm typecheck`、`pnpm lint` 与 `pnpm architecture:check --changed` 使用 Node 24.14.0 重跑：类型检查通过，Lint 72 个已有 warning、0 error，架构 0 baseline/0 new violation。实际 Electron 窗口已确认 `+` 菜单入口和弹窗可打开、关闭，普通会话不显示空委派栏；未提交真实委派或付费模型请求。
- 2026-10-07，`@` API 目标扩展：委派、API/ACP 执行器、MCP、创建身份、恢复、附件、工作树与提及回归 52/52 通过；包含实际 stdio 反向请求验证 API 子会话在 binding ACK 前仅获得 SubmitDelegationResult，以及 execution kind / cwd 隔离与嵌套设置。
- 扩展的 fake Host E2E 在 1280px/375px 通过：API/ACP 主会话可 @ API 模型，手动选择 API 保留完整模型配置，同名不同 provider 的选项可区分，选择不创建任务或切换主会话。附件、文件引用、主草稿、既有操作和设置仍通过；无页面异常或横向溢出。API 提及断言按场景拆到独立测试辅助文件，保持原验收覆盖及文件行数限制。
- 本轮根 typecheck、CLI 15 包递归 typecheck、根 lint 与架构检查通过；Lint 72 个已有 warning、0 error，架构 0 violation。32 个相关文件格式检查及 `git diff --check` 通过。production CLI 构建、Agent bundle 暂存与 Desktop main/host/preload/scheduler 构建通过。
- 桌面应用已重启：实际 `@` 列表含 GLM-5.3 与 GLM-5.3-Flash 的 API 选项，选择 Flash 后主模型仍是 GLM-5.3；验证输入已清空，未发送真实模型请求，也未提交或推送代码。
- 2026-10-07，`@` 候选图标修复：扩展委派 E2E 在 1280px/375px 通过，验证 Codex/Claude 品牌图标、不同 API provider 的独立 logo、16px 固定尺寸、素材解码及原有选择/发送身份。15 个 ACP 图标的亮暗主题、键盘与窄屏回归，以及 API 图标 Host 隔离回归通过。
- 本轮根 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过；Lint 72 个已有 warning、0 error，架构 0 violation。7 个相关文件格式检查与 `git diff --check` 通过。实际 Electron 窗口已热更新显示 ACP 品牌及智普 API 图标；未发送真实模型请求，不改变主模型，未提交或推送代码。
- 2026-10-07，委派层级设置扩展：6 个新层级测试及既有委派、API、MCP、创建身份、恢复和提及回归联跑 30/30 通过。覆盖 1/8 层边界、第 9 层拒绝、API/ACP 混合链条、真实 MCP 工具目录、SQLite 重开与 identity 隔离、执行中降低限制后已接受子任务继续调度及容量回落。
- 扩展后的 fake Host E2E 在 1280px/375px 连续两次通过：关闭嵌套仍显示有效层级 1，开启后输入 8 并失焦自动保存，层级/并发原子联动，保存尚未返回时连续修改不覆盖，非法输入与保存失败恢复原值，重新挂载保留配置。截图确认窄屏控件无重叠或横向溢出；断言等待服务回执与界面值同时一致，不用固定延时。
- 本轮 root typecheck、lint 与架构检查通过，Lint 72 个已有 warning、0 error，架构 0 baseline/0 new violation。修改涉及 UI、Shared 与 Services 的原有职责，不新增配置 owner 或持久化字段。Desktop main/host/preload/scheduler 构建通过，最终产物使用 production 环境及 preview 身份；Host 产物已确认包含 1–8 层校验和旧链条容量推导。当前应用未重启，需重启加载新的 Host；未调用真实模型、提交或推送代码。
- 2026-10-07，参考 Codeg 协作通用设置：主开关、直接深度、512 MB 默认缓存及并发已接入同一自动保存路径。新增 7 个设置/缓存场景，委派专项联跑 37/37 通过，覆盖旧写入兼容、严格拒绝 null/非法预算、API/ACP MCP 隐藏、旧 capability admission 拒绝、异步校验期间关闭、已接收任务完成及提交结果、缓存淘汰/副本/版本/回滚。
- 最终紧凑布局的 fake Host E2E 连续两次通过：1280px/375px、Zai Light/Zai Dark 下无横向溢出，控件在视口内；开关、深度 1–8、0 MB、并发协调、连续待完成写入、非法输入、失败回退、重新挂载及原有聊天/提及回归通过。截图核对确认亮暗主题文字和控件清晰、标签不与控件重叠；最初开发服务停止和一次保存断言超时未记为通过。
- 本轮最终 root typecheck、lint、架构检查与桌面 main/host/preload/scheduler production-preview 构建通过，Lint 72 个已有 warning、0 error，架构 0 baseline/0 new violation。设置事实由委派服务与原 SQLite JSON 记录持有，缓存仅为 Repository 的派生投影；共享设置行新增可选 compact 布局，不改变原有行布局。前端开发服务已恢复至 `http://localhost:5174`，本轮未重启桌面应用、调用真实模型、提交或推送；主开关及缓存后端需重启加载。
- 2026-10-07，独立设置入口迁移：导航、中英文提示及 ACP 目录回归 11/11 通过（UI 导航测试通过 `pnpm exec tsx --tsconfig packages/ui/tsconfig.json --test` 运行）；设置、缓存与提及回归 8/8 通过。导航新增 `delegation`，配置仍由原 `AgentDelegationService` / SQLite 持有，不新增写入路径或后端改动。
- 扩展的 `node packages/ui/test/agentDelegation.e2e.mjs` 在 1280px / 375px、Zai Light / Dark 下通过，覆盖独立菜单、SDK 页无委派设置、标题不重复、分区记忆、一次性意图、返回后保存值不变，以及原自动保存、非法输入、失败回退和聊天回归；截图核对无控件重叠或横向溢出。
- 本轮 root typecheck 通过，root lint 为 72 个已有 warning、0 error，架构为 0 baseline / 0 new violation；12 个相关文件格式检查及 `git diff --check` 通过。当前 Electron 窗口已热更新，实际打开独立页面确认一个标题、一组设置控件且未挂载 SDK 内容；仅浏览导航，未修改真实配置、重启、调用模型、提交或推送。
