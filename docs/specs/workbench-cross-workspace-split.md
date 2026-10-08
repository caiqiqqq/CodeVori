# 项目与任务会话的混合分屏

## 产品规则

- 从项目列表打开一个已有会话后，在任务列表右键另一会话的「在分屏打开」，保留原会话、输入草稿和 paneId，右侧显示选中会话。项目与任务可属于不同 workspace，API/native 与 ACP 任意组合使用同一分屏入口。
- 当前 ACP 主会话通过现有 pane 的只读会话投影提供 id 和 Agent；不能仅凭原生 `activeTaskId === null` 将它当成空草稿，也不能从旧打开请求猜测当前智能体。真正空草稿继续沿用临时草稿分屏。
- 分屏提交先把当前主会话和完整 workspace scope 固定到现有 workbench group，再允许右侧 native 焦点同步 shell 导航。切换 workspace、点击标签、关闭任意窗格都不能把另一会话替换为空白或新会话。
- 普通点击项目/任务中的已有分屏 ACP 行，聚焦该窗格；临时布局的已绑定 secondary 也沿用统一选择/替换路径。不执行「新建任务」的退出组/重置布局流程。未处于分屏的历史会话仍使用已有 ACP 打开与 Host refresh/load。
- 临时 secondary 从 API 切到 ACP 时，在同一选择事务里清除旧 scope 和目标 scope 的原生导航选择投影（现有 `setActiveTaskId(null)`），不调用 `startDraft`；否则旧 API ID 不再匹配 secondary 后会被误灌入主草稿。已有会话组只聚焦，不清除其他 pane 的原生选择。
- context menu 与拖拽读取同一主会话绑定。首次在 secondary API 草稿发送后，提升布局时保留原 ACP 主会话。重复分屏请求聚焦已有窗格，最多四个，真实新建任务继续退出组并回到主草稿。

## 所有者、接口与事件顺序

- `workbenchGroupStore` 唯一拥有显式会话组及持久绑定；`paneLayoutStore` 唯一拥有尚未提升的草稿布局。`WorkspaceShellLayout` 从已有 ACP 投影与 native 选择态派生主会话 binding，不新增打开会话 store、Host 状态或双写缓存。
- `workbenchSessionPlacement` 负责 typed binding 构造、布局 placement 和普通选择，普通选择返回目标是否已由 group/secondary pane 持有。临时 secondary 提交回调由 shell 路由既有原生选择清理 action，不新增导航状态。ACP 选择仅在返回 false 时进入原主 pane 打开路径。`V4WorkspaceChatArea` 读取同一只读主 binding，用于拖拽、焦点和 secondary 首发提升。
- 每个 binding 固定 workspacePath、workspaceIdentity、remoteSessionId、kind、sessionId 与 ACP Agent。身份比较继续使用 `workspaceIdentity?.trim() || workspacePath`，同 ID 不同 native/ACP 或不同 identity 不能合并。

```text
已打开主会话（现有 ACP 投影 / native 选择）
    → 派生完整 typed binding
右键另一行 / 拖拽
    → 统一 placement → workbench group 原子持有左右 binding
    → native 焦点才同步 shell workspace/task 导航
    → keyed panes 各自读取原 Host，会话与草稿保持

普通选择已在分屏的 ACP 行
    → 统一 placement 聚焦 / 替换 secondary → 原 pane 的 Host 加载
    → 不调用原生 task 选择或新建任务重置
```

- 没有新增协议或网络读取；Host owner/lease、Desktop continuous 和手机 replayable 语义不变。手机远控仍为单列。没有确认的 ACP 投影不虚构一个已打开会话；旧原生调用方可沿用 native session fallback。

## 验收

1. 单测覆盖主 binding 的 ACP 优先、native/空草稿 fallback、Agent 和远端 attachment；跨 workspace 的 ACP→API、API→ACP、ACP→ACP 和 API→API；重复打开、已有组选择、临时 secondary 替换及同 ID 隔离。
2. 浏览器使用实际 shell 分屏/选择入口、布局所有者与 pane chrome；合成 SessionPane/Host 边界，禁止触碰真实历史、创建 Agent 或发送 prompt。截图场景：项目 ACP A → 任务 API B 分屏 → 聚焦 B、A、关闭 B，A 的标题、正文、输入草稿与 paneId 全程保留。
3. 覆盖两处侧栏入口、拖拽、secondary 首发、窄/宽屏、浅/深色、普通点击分屏 ACP 行；保留真实新建任务、关闭、归档与刷新恢复回归。
4. 执行目标单测/E2E、`pnpm typecheck`、`pnpm lint`、改动文件格式和架构检查，分别记录既有与新增失败。
