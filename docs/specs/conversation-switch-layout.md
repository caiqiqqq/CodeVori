# 对话切换首帧布局

## 产品规则与所有者

- API 与 ACP 共用的 `ConversationTimeline` 唯一持有当前面板的虚拟行测高与位置。切换会话时，旧会话测高不得用于新会话；同一会话改变窗口顺序时，测量必须继续绑定真实 render-unit key。
- 新对话的已挂载历史轮次在首次绘制前完成测高与位置协调，不出现按估计高度堆叠的正文。不能用延时、淡出或隐藏列表掩盖错位。
- 保留原 Timeline、滚动容器和 composer 实例，输入 DOM、草稿、焦点与原生滚动记忆不因修复重建。历史窗口 prepend、流式 live tail 与完成态迁移继续复用当前测高和锚定路径。

## 接口、时序与边界

仅修改 ui 内部布局协调，不新增协议、持久化或业务状态。Host 与现有投影继续拥有会话事实，Timeline 只拥有 renderer-local 几何。

```text
Host / 投影切换 session → Timeline 接收身份与 render units
                         → 虚拟行身份失效旧几何
                         → DOM commit 测量当前行
                         → layout 协调位置并恢复滚动 → 浏览器首帧绘制
desktop continuous ── 实时投影 ───┐
mobile replayable ── 快照投影 ────┴─ 共用同一 Timeline 布局规则
```

异步 rows 到达仍走原投影路径；布局回调不能把旧会话 DOM 的尺寸写成新会话尺寸。workspaceIdentity、remoteSessionId、owner/lease 与 stale-run 边界继续由原层负责。无数据迁移。

## 验收

1. 两个历史对话使用重复 turn/row ID，但正文高度不同；连续切换后每个可见绘制帧的相邻历史轮次不重叠。
2. 挂载长正文、从草稿进入会话及切换时先收到空 rows 再收到完整 rows，同样在首帧正确排列。
3. 同一会话 prepend 或同数量窗口替换时，尺寸与位置跟随真实 key；流式输出、终态、回到底部和恢复历史阅读位置不回退。
4. 切换期间 composer 与滚动容器 DOM 保持；宽屏与手机宽度、浅色与深色无横向溢出或页面错误。
5. 使用真实 Timeline 与浏览器逐帧几何采样回归，合成会话不调用真实模型；运行相关测试、typecheck、lint 与架构检查。手机宽度回放仅证明共享 UI 布局，不代表已验证真实远程连接。

## 本地验证（2026-10-09）

- 基线 E2E 复现长正文以 72px 间距排列、首帧多轮重叠。修复提前按 session/logEpoch 创建测高缓存、按真实 key 序列失效虚拟位置，并在切换仍处于滚动状态时同步测量当前挂载窗口；原 Timeline 与 composer 不重挂载。前插锚点使用同一个虚拟身份 key。
- `pnpm exec tsx packages/ui/test/conversationSwitchLayout.e2e.mjs`：真实 Timeline 在 1280px/375px 与 Zai 浅色/深色共采样 552 个帧时点；切换无重叠，草稿/滚动容器 DOM 与阅读位置保留，真实 loadOlder 前插的可见轮次位置不变，无页面错误或横向溢出。截图已检查。
- `ZCODE_E2E_BASE_URL=http://127.0.0.1:5187 pnpm exec tsx --tsconfig packages/ui/tsconfig.json packages/ui/test/acpStreamingSnapshots.e2e.mjs`：现有真实 Host 流式保存、终态、1280px/375px 快照回放通过。`acpConversationRows`、`acpThoughtsAndPlans`、`acpCompaction` 投影测试 13 项通过；测试需传入 UI 的 tsconfig 解析路径别名。
- Node 24.14.0、pnpm 10.33.2。首次 typecheck 因未生成 dynamic-workflow/runtime 的 dist 类型失败；使用两个包现有 build 命令补齐后，完整 `pnpm typecheck` 通过。`pnpm lint` 为 0 错误、72 项现有警告；架构检查当前/基线/新增均为 0，改动文件格式与 whitespace 检查通过。
- 改动仅属于 ui：源码净新增 31 行，含 spec 与 E2E 共 3 个文件净新增 327 行。几何仍由 Timeline 唯一持有，实时与回放共用原投影路径，不改变 Host 状态、接口或持久化格式。
- 本地 freshness 检查通过；远端 fetch 因网络连接失败未完成，未声明远端最新基线一致。未建立真实手机远程连接，未重新打包或替换当前安装版，未提交或推送。
