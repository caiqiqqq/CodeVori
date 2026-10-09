# ACP 流式快照写入

## 产品规则与所有者

- 目标 Host 的 `IAcpService` 仍唯一持有 ACP 正文、思考、压缩摘要、工具、队列与单调 revision。适配器分片保持原文及接收顺序，不补字、不制造打字动画，也不能消除上游生成或重连的停顿。
- 高频正文、思考与压缩摘要分片追加到同一 Host 会话后，合并等待写盘的流式快照任务。每个会话最多一个正在写入的流式快照和一个待写任务；待写任务只引用 owner 会话，执行时才克隆、校验和序列化最新快照，不逐 token 排队保存完整历史。
- 合并按现有写入 Promise 的完成推进，不设置 debounce 或定时等待窗口。孤立分片立即进入可执行写入；分片持续到达也不能无限推迟已排定任务。每个分片的更新 Promise 必须等包含该分片的 revision 成功落盘才完成，写入失败仍向既有适配器错误路径传播。
- 用户输入接纳、工具、权限、配置、停止、错误与完成仍走现有立即保存路径。它们的快照包含此前接收的全部分片，与流式写入共用同一文件写入队列。不得在终态或新轮之后广播旧 running 快照。
- 广播仍只发生在原子文件替换成功后。已经由其它保存路径覆盖的 revision 不重复保存或广播；UI 可跳过合并掉的中间 revision，但不能倒退或遗漏正文。
- 删除先撤销运行所有权，等待待写任务后删除所属文件，迟到分片不得重建历史。Host 关闭等待流式任务及其产生的文件写入，禁止关闭后广播。没有协议或文件格式迁移。

## 事件顺序与交付边界

```text
ACP 分片 → generation / command 守卫 → Host 按序追加 + revision
                                     → 每会话待写任务合并
                                         → 原有文件写入队列 → 原子替换 → Host 快照通知
工具 / 权限 / 接纳 / 终态 ───────────────→ 原有立即保存路径 ────────┘
desktop continuous：既有 attachment 实时通知 → UI 快照投影
mobile replayable：既有 attachment 通知 / 重连读取 → 同一 Host revision
```

workspace identity/path、remoteSessionId 路由、owner/lease 与旧进程/旧 run 守卫保持现有边界；不引入 Renderer 的正文缓存或第二条写入路径。API 原有增量流不变。

## 验收

1. 长会话中同时到达大量单字分片：写入/广播次数显著低于分片数，文本逐字完整且按序，首个可执行快照包含当前已收到内容。读取磁盘及重启后快照与最终 Host 事实一致。
2. 第一批快照写入期间再收到分片：后续内容由下一个待写任务保存；各分片 Promise 不能在其内容落盘前完成。持续输出期间无需等整轮结束才显示正文。
3. 分片与工具、思考、压缩摘要交错，完成/停止紧接突发分片：顺序及 messageId 段身份保持；终态已保存完整尾段，不再广播旧 running 状态。
4. 两个 workspace identity 或会话同时输出：合并范围仅限各自 Host id，不串字；手机重连读取对应 Host 的最新 revision，不要求中间 revision 连续。
5. 待写期间删除、关闭或适配器退出：不复活文件、不在关闭后广播；等待关闭接口保存已收到的分片。失败仍可观察，不把保存失败报告为成功。
6. 服务测试覆盖突发分片、落盘屏障、终态、停止、关闭、删除及失败；fake stdio 覆盖消息接收顺序；浏览器场景用真实时间轴验证流式更新和 replay。测试使用合成数据与隔离目录，不向真实 Agent 发送模型请求。

## 本地验证（2026-10-09）

- Node 24.14.0、pnpm 10.33.2。关闭合并路径时，512 个单字分片产生 512 次完整快照广播并触发回归失败；合并后同样输入只产生 1 次广播，磁盘正文完整。
- `pnpm exec tsx --test packages/services/test/acpStreamingSnapshots.test.ts`：10 项新增回归通过，包含在途写入、失败传播、跨 identity 隔离、重启、生命周期边界及真实 stdio 的 256 个单字分片 + 立即完成响应。
- 相关既有服务测试（`acpService`、`acpStdioConnection`、`acpMessageQueue`、`acpCompaction`、`acpThoughtsAndPlans`、`acpSessionFailures`、`acpAttachments`、`acpWorkflows`）93 项通过；UI 的 `acpConversationRows`、`acpThoughtsAndPlans`、`acpCompaction` 投影测试 9 项通过。
- `pnpm exec tsx packages/ui/test/acpStreamingSnapshots.e2e.mjs`：真实 Host 保存合成适配器快照，真实时间轴在 1280px/375px 验证首字、运行中后续正文、完整终态、快照重放不重复及无横向溢出；页面无异常，截图已检查。此测试未建立真实手机远程连接，也未向真实模型发送请求。
- `pnpm typecheck` 通过；架构检查 0 当前/基线/新增违规；Lint 为 0 错误、72 项现有警告；改动文件格式和 whitespace 检查通过。6 个文件净新增 618 行（含 spec 与测试），其中 services 源码净新增 36 行。仅修改 services 模块的保存调度及接口说明，复用原 RPC 通知、会话文件格式和 UI 投影。
- 开工 freshness 的远端 fetch 因网络连接失败未完成，因此不声明与远端最新版本一致。当前安装版未重新打包或替换。
