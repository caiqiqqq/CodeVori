# ACP 会话复用 ZCode MCP 与技能配置

## 产品规则与所有者

- 目标环境 Host 是 ACP 会话、配置读取与命令接纳的唯一所有者。Desktop 和远程 Web 都经目标 Host 的现有 `IAcpService`；Renderer 只保留未发送的草稿。`workspaceIdentity?.trim() || workspacePath` 隔离会话，`workspacePath` 用于读取项目配置、执行路径和 ACP `cwd`。
- ACP 新建或恢复原生会话前，在目标 Host 读取现有 MCP 设置：工作区 `.zcode/config.json` 和用户 `~/.zcode/cli/config.json`，各作用域没有 ZCode MCP 时沿用现有 `.agents/mcp.json` 回退。只选已启用的设置，按现有设置页规则同名优先工作区、然后用户。不要读取 Renderer 的 MCP 缓存、跨主机转发凭据、复制 ZCode Provider API Key，或修改智能体原生配置。
- `session/new` 和 `session/load` 都传同一连接启动时的 MCP 快照。stdio 命令由目标 Host 的工作区或 Agent 启动 PATH（包括该 MCP 自己设置的 PATH）解析成绝对路径；HTTP/SSE 只在 Agent 声明相应 MCP capability 时传入。ACP 不支持的 ZCode 特有 OAuth、官方身份、CUA broker、非默认的隔离/协议版本/超时、不同的服务 cwd 或缺少可执行文件的已启用配置，在创建/恢复阶段给出不含凭据的错误；不能让用户误认为已注入。插件贡献的 MCP 仍按原有插件能力边界处理，本功能不把插件服务当成普通设置项转发。新增配置或开关变化只对新连接生效；既有连接不重启、不重复注入。
- 技能沿用目标 Host 的 `ISkillsService` 查找与启用状态。ACP 输入框复用现有 `$` 技能候选，候选从当前设置列表读取，不查询原生 API/ZCode 会话的冻结 runtime catalog，也不因此启用 ZCode 专用的 `@` 或 `/` 命令。用户显式输入 `$技能名` 或选择技能候选时，发送前调用现有 `buildPromptContext`；仅将已启用、命中完整名称的技能正文附加到本轮 ACP 文本块，仍以用户原文写入会话快照/搜索记录，不把技能全文持久化。大小写、下划线与带空格的候选名称按保存的原名匹配；同名按现有候选顺序优先工作区、插件、用户，只注入一份。普通提问、禁用或不存在的技能不附加正文。Agent 自身的技能目录可能独立生效，不读取或改写其配置。
- 能力校验及技能读取都在 Host 接纳用户输入之前完成；失败保留输入草稿、不生成用户行。沿用现有 commandId 幂等接纳与连接 generation 防旧流。用户文本、技能正文、MCP 环境和请求头不得写到诊断日志。

## 顺序与恢复

```text
目标 Host MCP 配置 → 启用/作用域选择 → Agent initialize/capabilities → 格式校验
                                             → session/new 或 session/load (MCP 快照)
用户草稿 → Host 会话校验 → 技能启用列表/显式命中 → ACP 内容块 → 接纳原文/发布 revision
                                                           → session/prompt (临时技能上下文)
Desktop continuous 通知 ─┐
                         ├─ 同一 Host 会话快照、revision 和 commandId
Mobile replayable 恢复 ──┘
```

恢复只向 `session/load` 传新的 MCP 快照，不重放显示历史或旧轮技能内容。MCP 配置变更不写回会话快照；连接上的运行时事实由 Agent 决定。

## 验收场景

1. 工作区和用户有重名服务，禁用状态、回退来源和优先级与设置页一致；新建/恢复 ACP 会话各收到一份允许的配置，无跨工作区或跨主机凭据。
2. stdio PATH 或工作区相对命令解析为绝对路径；HTTP/SSE 依能力选择。缺少能力、不可表示的 OAuth/官方认证/CUA 和丢失命令报告明确错误，不静默降级或发送秘密。
3. `$` 候选只显示已启用技能；提问明确引用时 Agent 收到正文，Host 快照仍是用户原文；普通提问和禁用技能不注入。发送前失败不接纳用户行，重试使用同一个 commandId。
4. 切换 API/ZCode 仍走既有路径；桌面与手机 Web 同一输入框可发送，ACP 恢复沿用同一目标 Host 快照与历史展示。

测试入口以 `packages/services/test/acpService.test.ts`、`acpStdioConnection.test.ts` 和 `packages/ui/test/` 的实际用例为准，至少覆盖可表示的转换、受限类型失败、恢复及技能命中，交互场景覆盖 `$` 候选及提交。
