# ACP 切换、状态更新与发送等待

## 产品规则、所有者及边界

- ACP Host 仍是连接、已接受输入、队列、附件副本与 revision 的唯一所有者；UI 仅拥有选择意图、尚未接受的草稿、操作等待及可见行的临时预览 URL。
- 可见消息的图片/视频预取按附件的有效 ref、MIME、原序号及 workspace/session/reader/row target 标识生命周期。连续事件或重连快照即使克隆了附件数组，只要这些输入相同，不取消读取、不销毁 URL、不重新读取。附件目标或读取 Host 改变、行卸载时仍取消并释放；不新增跨会话内容缓存。
- 同一 Agent 的旧会话恢复/配置/停止操作不得阻塞新选中的会话。等待状态绑定完整 workspace target、草稿 epoch、Agent 和会话 id；草稿连接等待仅作用于无选择的对应草稿。旧响应仍需经过既有 request/revision/selection 守卫。
- 显式打开当前 ACP 会话也属于新的选择意图：即使 Host 没有新 revision、所选会话对象未变，清除就绪标记后仍须执行既有 refresh。回复结束且没有后续通知时，不能停留在不可发送状态，也不要求切换到其它会话恢复。useAcpConversation 的 selectedIds 是选择意图的唯一状态；不新增连接状态或发送路径。
- 已就绪会话发送直接调用 `submitPrompt`，不再串行调用重复 `refresh`。Host 的 admission 仍核验连接、权限、能力、附件及幂等键，失败保留草稿；确认丢失沿用同 commandId 的 read 对账。不能提前把 UI 就绪当作 Host 接受。
- 不改变 owner/lease 或跨 Host 路由，不缩短超时来掩盖同步问题，不改主智能体或委派规则。

### 跨工作区首次打开历史

- `useAcpConversation` 在 workspace identity/path 变化时先清理旧选择，再由 pane 消费新打开意图。该清理不依赖 ACP 是否激活、列表是否返回或订阅是否建立；不能在延迟激活后清掉当前工作区刚选中的历史 id。
- 选择仍由既有 `selectedIds` 唯一持有，Host 仍拥有历史和连接；列表加载不创建第二条选择写入路径。同路径不同 identity 必须隔离，仅 `remoteSessionId` 变化时保留同工作区的选择并重订阅。
- 首次历史点击必须直接显示该 id 的历史并走既有 refresh，不能误走草稿 create。旧工作区延迟 list/refresh 或旧 attachment 响应不能覆盖新工作区。显式新建任务仍清理历史选择。

```mermaid
sequenceDiagram
  participant Pane as SessionPane 打开意图
  participant UI as useAcpConversation 选择所有者
  participant Host as 已有 Host
  Pane->>UI: 工作区 identity/path 改变
  UI->>UI: 无条件完成旧作用域选择清理
  Pane->>UI: 消费本次精确历史 id
  UI->>Host: 初始化订阅、读取列表、refresh 历史
  Host-->>UI: 当前 target 的历史投影
  Note over UI,Host: Desktop continuous / 手机 replayable 共用此选择顺序
```

验收：真实 SessionPane 从未激活的项目草稿首次跨项目选择历史成功；同项目首次、跨 identity、已有 ACP 激活后跨项目、同工作区 attachment 重连、旧读取迟到均保留正确目标。连续与恢复链路均验证，不发送模型请求。

2026-10-15 验证：`acpFirstSelection.e2e.mjs` 修复前在跨项目首次打开的历史可见性断言失败；修复后真实 SessionPane 的同项目/跨项目首次、相同路径及 id 的不同 identity、激活后切换、旧 list/refresh 迟到、新建草稿、attachment 重连均通过，历史打开不调用 create。1280px continuous 与 394px replayable 目标均覆盖。现有 `acpInteractionLatency.e2e.mjs`、`acpMessageQueue.e2e.mjs`、`acpArchiveSelection.e2e.mjs` 回归通过。仅合成 Host 与历史内容，未调用真实模型或安装程序，未验证 iPhone Safari 实机。

```mermaid
sequenceDiagram
  participant UI as Pane 选择/草稿
  participant Media as 可见行预览
  participant Host as ACP Host 唯一所有者
  participant Agent as ACP Agent
  UI->>Host: refresh(所选 session，既有恢复入口)
  Host-->>UI: 就绪快照
  UI->>Host: submitPrompt(session, commandId)
  Host->>Host: attach 核验 + 副本/接受快照落盘
  Host-->>UI: durable acceptance ACK
  Host->>Agent: 同一轮 prompt
  Host-->>UI: Desktop continuous / Mobile replayable 快照
  UI->>UI: 回复完成后显式重开同一会话，更新选择意图
  UI->>Host: refresh（不依赖后续 Host 通知触发）
  Host-->>UI: 同一目标就绪；恢复发送，保留草稿
  UI->>Media: 同一附件内容标识
  Note over Media: 保留在途读取/已加载 URL
  UI->>Host: 选择 B（A 的恢复可仍在途）
  Note over UI: B 仅等待 B 的操作，迟到 A 不覆盖 B
```

## 验收

- 真实 SessionPane/图片组件 + synthetic Host：同一可见行生命周期内的 idle/running 连续克隆快照保持图片 URL 和读取次数（当前轮在 live tail/虚拟历史之间移动时沿用原重挂载规则）；新增或替换 ref 读取新内容，切换会话不会显示旧图片。1280/375px 都覆盖。
- 真实 useAcpConversation：A 恢复挂起时选择同 Agent 的 B，B 就绪后可发送，迟到 A 不影响 B；idle/running 输入都只经过 submitPrompt，不产生发送前 refresh。错误与旧响应隔离仍成立。
- 真实 SessionPane / Composer：模拟回复完成，保留下一条草稿，再次打开相同 session（新的打开 request）；没有后续 Host 通知时仍须 refresh 并恢复按钮和 Enter，正文保持不变且只提交一次。覆盖 1280/375px、浅深主题及 Desktop continuous / Web remote replayable；旧请求仍通过既有 request/revision/selection 守卫，不引入超时解锁。
- 运行现有图片/队列/草稿/归档回归，以及 typecheck、lint、changed architecture 和改动格式检查。日志证据与 synthetic 验证不能表述为已安装应用的性能修复。

## 本地验证（2026-10-09）

- 当天运行日志中 `acp.readAttachment` 37,216 次，最长 8,714.3 ms；`acp.submitPrompt` 67 次，中位 57.0 ms、最长 430.6 ms；`acp.refresh` 最长 6,290.5 ms。这些是服务端 RPC 耗时，不包含排队、Renderer 消费及 Agent 请求时间，不能证明每次半分钟卡顿都来自同一原因。保存的 Agent 事件另有 12 条 `Reconnecting... 1/5`，属于 Agent 重连事实。
- 同一测试用例通过临时 baseline 模块验证旧源码：A 恢复未完成时 B 在 3 秒检查内仍不可用；4 次克隆快照新增 8 次图片读取。当前源码中 B 不等待 A，克隆快照既不增加已加载图片读取，也不取消尚未返回的图片读取。
- Node 24.14.0：UI 读取/行投影/admission 19 项与 Host 会话/队列 48 项共 67 项通过。5 组 E2E 通过：会话等待隔离与发送、图片/时间轴、草稿复用、归档、消息队列；覆盖 1280/375px、附件替换及拒绝重试。图片/队列/时间轴沿用真实组件与 synthetic Host，无真实模型请求。
- 动态工作流依赖构建后根 `pnpm typecheck` 通过；`pnpm lint` 0 errors、72 warnings；架构 current/baseline/new 均为 0；改动格式与 `git diff --check` 通过。首轮检查受缺失依赖产物影响，不计为通过。
- 状态所有者和协议不变，源码仅修改 ui 模块，净增 29 行。未构建或替换已安装应用，未提交、推送；真实使用的端到端卡顿需新版运行验证。

## Issue #153 本地验证（2026-10-15）

- GitHub issue 已核实。新增真实 SessionPane/Composer 回归：回复完成后显式重开同一会话，Host 不再发布通知；修复前等待 refresh 超时，修复后恢复发送且保留草稿。此证据确认一种触发路径，无法仅凭截图认定用户当次故障的完整事件顺序。
- `acpMessageQueue.e2e.mjs` 通过，覆盖 1280/375px、浅深主题、continuous/replayable 目标、Enter/按钮各只提交一次及既有队列回归；`acpInteractionLatency.e2e.mjs` 与 admission/queue projection 9 项测试通过。使用 synthetic Host，无真实模型调用或手机网络连接。
- Node 24.14.0：首次 typecheck 缺动态工作流构建产物；构建这两个现有依赖后重跑通过。Lint 0 errors、74 项已有 warnings；架构 current/baseline/new 均为 0，改动格式与 diff 检查通过。源码仅 ui 模块净增 2 行，未增加状态所有者、协议或写入路径。
- 未提交、推送或替换已安装应用；截图中的实际故障仍需新版运行确认。
