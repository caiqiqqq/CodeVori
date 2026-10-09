# 分屏消息队列隔离与操作反馈

## 产品规则

- 已有 ACP 会话的输入正文、编辑器状态、附件及配置菜单使用 `acp:<Host session id>` scope；API 沿用原生 session scope。workspace identity 优先于路径，ACP 与 API 同名 id 不共享草稿。
- ACP 尚未获得 Host id 时使用 pane 与 Agent 隔离的临时 scope；精确打开已有 ACP 会话时优先使用绑定 id，不能暂时恢复其他会话或旧 `__draft__`。旧共享草稿无法确定归属，不自动复制到历史 ACP 会话，原记录保留。
- 仅新建 ACP 连接的 provisional id 可以接管同一 pane/Agent 的临时草稿和未发送附件；保存目标后清理来源。历史打开、跨 workspace 和其他 pane 不执行此转移，连接期间输入不能丢失。
- 切换会话、分屏挂载、重挂载和远控重连只恢复当前 scope；清空已接受输入和附件只作用于提交时冻结的 scope。
- API/ACP 队列列表最多占据会话视口高度的 30%，且不超过 12rem，超出时在列表内部滚动；暂停提示和输入框不参与队列列表滚动。拖动排序使用当前可见列表作为边界。
- API 队列删除、撤回编辑、排序、立即发送和恢复：目标 snapshot 必须匹配当前会话；拒绝或网络失败给出提示。stale ACK 使用既有 store recovery 获取权威投影，提示用户重试，不自动重放停止/发送/删除操作。切换目标后旧错误和 recovery 不作用于新会话。

## 所有者与时序

- `useDraftConfigControl` 继续唯一拥有本地正文及配置草稿，附件由既有 `composerAttachmentUploadStore` 按同一 scope 持有。scope 由 SessionPane 显式下发，不把 ACP id 当作原生协议 id。
- ACP Host 与 API CommandInbox 继续唯一拥有 accepted queue；不新增客户端接受队列，不改变 owner/lease、幂等或 admission 边界。

```text
pane 的 workspace identity + typed session → 统一 composer scope
  → 本地草稿 owner / 附件 owner → 对应 Host admission
  → 原 scope 内容清理；另一 pane 的 scope 不变

队列操作 → 当前目标校验 → 原命令通道 → ACK
  ├─ accepted/noop/duplicate → 权威投影更新
  └─ stale → 同目标 store recovery + 可见重试提示（不重放命令）
```

- Desktop continuous 和 Mobile replayable 继续由同一 Host owner 发布；recovery 复用当前 owned subscription，不另起 Agent 或远程会话。

## 验收

- 真实 SessionPane/composer + synthetic Host：同 Agent A/B 分屏，A 正文及附件不在 B 恢复；B 重挂载、A→C→A、Host admission 和迟到 ACK 都不串写或清除另一 scope；重连保留原 scope。
- 同路径不同 workspace identity 与 API/ACP 同名 id 隔离；既有 API 草稿 key 保持兼容。
- 横向/上下分屏、1280/375px、浅/深色：25 条队列内部可滚动，输入框保持可见，最后一项仍可操作；暂停/恢复与排序继续有效。
- API 操作 stale、rejected 和 transport-error：不自动重发，stale 触发一次 recovery，有用户反馈；导航后的迟到结果不恢复/提示新目标。
- 修复原队列 E2E fixture 缺失 `usageTurns` 的 schema 漂移，实际执行相关单测、E2E、typecheck、lint、格式和架构检查。
