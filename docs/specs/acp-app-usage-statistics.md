# App 使用统计中的 ACP 用量

## 产品规则

- 设置 → 使用统计 → 应用用量显示全部来源的可确认 Token 总量，并按 ZCode/API 与每个 ACP 智能体列出用量。ZCode/API 原有按模型图表和峰值、最长会话、当前及最长连续使用天数保留，且明确标出其范围。按时间范围筛选同时作用于所有来源。
- 设置页不再显示重复的“按来源统计”卡片。上方总览保留累计可确认 Token、ZCode/API、ACP 与未知轮次；来源标签继续提供 ZCode/API 图表和每个 ACP 的独立明细。来源增多时不会另加一份来源列表；桌面和窄屏均能使用来源标签。
- ACP 智能体单列会话数、已发送轮次数、可计量轮次数、无法计量轮次数及实际 Token。空会话不计数；无用量报告不能记成 0 Token 的已计量轮次。全部总量只加已报告、经会话增量转换的 Token；明确显示缺报轮次，避免误以为完全覆盖。
- ACP 1.5 的实验性 `session/prompt.usage` 文档同时出现“本轮”与“跨会话累计”，各适配器实现不同，不能全局推断口径。连接层先按已核验的适配器身份转成明确的 `turn / session` 用量报告；未核验适配器保持未知。`session/update` 的 `usage_update.used/size` 仅为当前上下文占用，不计入消耗。
- 已核验 `@agentclientprotocol/claude-agent-acp` 的 `usage` 为本轮主 Agent 累计；其 `_meta.quota.model_usage` 为实际模型的本轮统计，可能额外包含子 Agent/内部调用。模型行总量不低于主 Agent 总量时采用模型行合计，不把两份数据重复相加；否则只采用主 Agent 用量、不伪造缺失的模型归属。input 包含报告中的 cache read/write。
- 已核验 `@agentclientprotocol/codex-acp` 1.13.1 的 prompt `usage` 和 `_meta.quota` 仅为本轮**最后一次模型请求**；当前不能确认整轮消耗，因此仅计会话和已发送轮次，Token 保持未知。显示原因；不得把其配置模型或上下文快照当作实际消耗。
- 对后续确认会话累计的适配器，首次由新会话零基线计算，后续取同会话连续报告差额。缺报、非法值、历史无基线、停止/错误/Host 运行中重启、累计重置后的响应只建立基线，不把跨轮差额归给当前轮。单轮报告不依赖累计基线。缺失的 reasoning/cache 独立维度不显示为已知 0。
- ZCode/API 来源的按模型图表仅显示 ZCode/API；全部来源包含 API 和 ACP，各 ACP 来源显示该智能体的实际模型行。每个 ACP 独立分组，即使模型名相同也不混在一起。各来源均显示按已确认日期 Token 投影的全年活动图，样式、范围及缺失每日数据的规则以 `acp-app-usage.md` 为准。
- 已有 ACP 历史缺少用量事实，展示为不可补算的未知轮次。删除会话后其本地统计随快照消失；归档不影响统计。Coding Plan 是供应商额度数据，继续单独展示，不与本地 Token 合并。
- 冷启动后仅使用 ACP、没有活动的 ZCode/API 会话连接时，应用用量仍应读取当前 Host 的原生历史并显示 ACP 分组。统计读取不要求先切换 API 模型、登录或发送提问；原生读取失败不得伪装成零用量。

## 所有者和接口

- 目标 Host 的 `IAcpService` 持有 ACP 会话、增量基线与每轮已确认用量，并从其已有 JSON 快照产生全 Host 的只读汇总。按 `workspaceIdentity?.trim() || workspacePath` 维持会话隔离；全应用统计只读取当前连接目标 Host 的会话，不按同名路径拼接不同 Host。
- `IUsageStatsService.getAppUsageSnapshot` 从同一个目标 Host 的 `IZCodeAgentService` 和 `IAcpService` 分别读取数据，返回 ZCode/API 原快照及 ACP 分组；CLI 的 `v4/usage/stats` 协议和数据表不接收 ACP 会话 ID。设置页通过原有 hook 取得快照，不直接读文件。
- `IZCodeAgentService` 的全 Host 原生统计复用已有全局只读查询载体选择：优先使用仍有效的本 Host 本地 CLI 连接；没有可复用连接时，使用现有管理面进程读取同一全局 usage 库。不建立真实项目会话、不等待 provider/model readiness、不借用其它远程 Host 的连接，也不增加统计状态或独立进程池。查询和全局工作流共用该选择路径；Desktop 与手机恢复后都经所属 Host 查询。
- ACP 的一次 prompt `commandId` 是幂等键；仅 Host 接受的 user entry 对应一轮。成功返回时，若仍是当前命令且会话未删除，再原子更新基线、用量事实和状态。重放/重复提交不能累加；停止/连接退出后的迟到返回不得写入。快照写盘并发布 revision 后，桌面连续订阅和手机恢复快照读到同一事实；统计查询为只读投影，不建立第二个写入队列。

```text
ACP Agent prompt response (optional cumulative tokens)
  → target Host / IAcpService (commandId + baseline, accepted turn owner)
  → ACP session snapshot (one write + revision) → local/remote IAcpService usage query
                                           └─────→ IUsageStatsService + CLI native snapshot
                                                        → settings usage view

desktop: continuous Host revision ──┐
                                    ├─ same persisted ACP fact
mobile: replayable Host snapshot ───┘

settings usage query → target Host / IUsageStatsService
  ├─ IAcpService → persisted ACP facts
  └─ IZCodeAgentService → valid local CLI or existing management lane
                           → v4/usage/stats → native global usage store
  → join after both reads succeed → settings usage view
```

## 验收场景

1. 模拟明确 session scope 的 ACP，连续累计 100、160：显示 160，不显示 260。Claude 两份 turn scope 100、60 显示 160；实际模型行按各模型合并且缓存 Token 不丢失。Codex 仅 last-request 报告必须显示未知；ZCode/API 模型图表保持原数据。
2. 一轮未返回 `usage`，之后累计值恢复：缺报轮和恢复基线轮均显示未知，不把两轮差额归给后一轮；再下一轮才算差额。旧快照的首次累计响应也只用来建立基线；累计值降低时同样重建基线。
3. 重发相同 `commandId`、停止后的迟到结果、旧进程通知、删除和归档分别验证不重计、无迟到写入、删除不再计数、归档继续计数。Host 重启后的已有用量事实从快照保留；重连后首份累计报告仅建立新基线，下一份连续报告才计当前轮。
4. 设置页在“全部时间 / 近 7 日 / 近 30 日”查看 ZCode/API 和 ACP 智能体；来源标签在手机窄屏换行后不重叠；缺报的历史显示未知，不显示伪造的模型；手机 Web 与桌面看到相同目标 Host 汇总。远端同一路径但不同 identity 的会话不进入本地 Host 汇总。
5. 冷启动且未连接任何 API 会话，直接打开使用统计：原生历史仍能读取、Codex/Claude 来源和未知轮次可见；并发范围查询只复用一个管理面进程，不创建聊天会话或请求认证。已失效连接不被复用；查询失败继续返回原始失败，不把原生历史清零。
6. 切换到“全部来源”时不渲染“按来源统计”卡片，直接显示 ZCode/API 图表；总览仍显示全部来源的可确认 Token 和未知轮次。多个 ACP 来源时，最后一个来源仍可通过标签查看明细，窄屏没有横向溢出；切换时间范围仍得到对应统计。

## 迁移与验证

- 旧快照经兼容 schema 读取时，累计基线标记为未知；不回填旧 Token，也不改写旧消息时间。范围统计仅使用已有合法消息时间。
- 单测覆盖累计增量、缺报、旧快照、重启、重复和删除；交互 E2E 覆盖设置页来源分组、范围筛选、未知说明及 API 图表口径。执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`；有可用运行环境时执行 E2E。

## 本地验证记录（2026-09-28）

- Node 24.14.0、pnpm 10.33.2：ACP Host、stdio 用量投影及使用统计合并的目标测试 29/29 通过。
- `node packages/ui/test/acpUsageStatistics.e2e.mjs` 通过：隔离浏览器加载真实统计组件，覆盖全部来源、ZCode/API、ACP 切换、三个时间范围、实际模型行、Codex 未知说明、API 原摘要及 375px 窄屏来源标签换行。使用固定服务数据，不读取或修改用户会话。
- `pnpm typecheck` 通过；`pnpm lint` 0 错误、70 条既有警告；`pnpm architecture:check --changed` 的 baseline/new 均为 0；目标文件格式检查及 `git diff --check` 通过。
- 涉及 services/shared/desktop/ui；ACP 用量仍由目标 Host 单独写入，设置页只投影已确认事实。三个直接统计文件的当前 HEAD 差异净增 149 行；四个新增用量/展示文件合计 285 行。其它既有 ACP 文件未跟踪，不能用 Git 精确区分本轮与之前的改动。
- 基线检查提示本地 main 落后 origin/main 一个提交，未合并或覆盖现有工作区。已安装适配器口径经源码核对；没有发起真实付费请求，桌面原进程和远程手机链路未重启或进行实机验证。

## 冷启动运行验证（2026-09-28）

- 运行中旧 Host 缺少 `getUsageStats`；重启后 ACP 汇总可读，但原生统计在没有活动 API workspace client 时抛出 `no_active_workspace`，导致整个应用用量页面无快照。用上述全局只读载体修复后再次重启桌面开发版。
- 新增冷启动回归测试先复现失败、修复后与原有合并测试 2/2 通过；并发查询复用一个管理面进程，原生历史保持真实值、ACP 历史未知轮次可见，且未走认证或创建 API 会话。隔离 UI E2E 再次通过。
- 真实桌面 Host 的 `getAppUsageSnapshot` 同时返回原生历史与 ACP 分组；设置页面全部时间 Codex 为 2 会话、3 轮、3 轮未知，近 7 日为 1 会话、2 轮、2 轮未知。Codex Token 仍不可确认；没有读取或改写真实会话内容。`pnpm typecheck` 通过，`pnpm lint` 0 错误、70 警告，架构检查 0 违规，目标文件格式检查通过。
