# 侧栏会话行

## 原生会话完成与未读的组合

原生 API/ZCode 会话的完成状态与未读字段独立：`status=completed` 且存在数值型
`unreadAt` 时，沿用现有未读角标；没有 `unreadAt` 的已完成会话不显示状态角标。
sessions-index 的 `completedSuccess` 或 `completedInterrupted` 不应遮蔽已持久化的
未读标记。实时错误优先显示错误角标；没有 activity 时，持久化 `status=error`
也优先于未读。activity 已存在时，实时 phase 优先于遗留的持久化 error 状态。

```text
TaskIndexRepo：status / unreadAt ───────┐
sessions-index：实时 activity phase ───┴→ deriveTaskLeadingIndicator
                                       → 错误 > 未读 > 实时运行 > 无角标
```

回归测试覆盖完成未读、完成已读、错误优先和终态 activity 水合后的投影。
原生会话的未读生成、持久化与导航清除继续由既有服务和 hook 负责。

## ACP 对话结束后的未读（issue #104）

左侧项目、工作树、置顶和时间线列表中的 ACP 对话，在后台结束一轮后显示既有蓝色
未读角标。未读与 `idle` / `interrupted` 独立，不新增会话状态枚举或待办看板状态。
当前查看的对话结束后保持已读；点击未读对话后清除角标。手动标记未读仍可用。

ACP Host 是 `unreadAt` 的唯一持久化所有者。在真实 `running → idle/interrupted`
迁移的同一次 mutate 中生成新时间，然后原子保存终态和未读，再广播 summary。
草稿、已归档/被接替会话、显式停止和 Host 重启恢复不生成完成未读；普通配置、
流式分片和重复终态不更新未读。新一轮终态更新旧未读时间，便于条件清除区分结果。

侧栏读取所属 Host 的 summary。当前可见焦点窗格进入对话或从运行变为终态时，经现有
`updateRow(unread=false)` 清除观察到的 `unreadAt`；携带可选 `expectedUnreadAt`，
Host 在同一 queue gate 内比较后清除；点击侧栏行也复用该条件清除。侧栏折叠不影响
可见窗格确认已读。旧请求不能清掉更新的未读。旧调用方不带
条件时保留原行为。行的 scope 包含 workspace identity（本地路径 fallback）、
真实路径、attachment、服务实例和 ACP ID；不写入原生 task store，不伪造 UI 未读。
失败保留 Host 投影并记录日志；切换 scope 后迟到响应不覆盖新对话。

```text
ACP Agent 终态 → Host mutate(status + unreadAt) → 原子保存 → summary 广播
                                                          ├→ 后台行：蓝色未读角标
                                                          └→ 当前行：条件清除命令
点击后台行 → 既有导航 + 条件清除命令 → Host queue gate 比较 → 保存 → summary
桌面：continuous 接收；手机：replayable 恢复 summary 中同一 unreadAt，不重造未读
```

验收：Host 测试验证成功/失败终态、去重、重启恢复、显式停止、跨 identity 拒绝和
旧条件清除与新轮结束竞争。生产侧栏 hook 与行组件的 E2E 覆盖后台完成→角标、
点击→已读、当前项完成→已读、手动未读、迟到 snapshot、同路径不同 Host，以及
桌面/375px、浅深主题。效果图使用合成数据，不修改真实用户历史。

## ACP 失败角标（issue #132）

左侧项目、工作树、置顶和时间线的 ACP 会话行，在所属 Host 摘要为
`status=interrupted` 且 `error` 非空时，在智能体图标右下角显示与 API 会话一致的
红色失败角标；失败优先于未读。只有 `interrupted` 而没有错误时不判为失败，
主动停止进入 `idle` 时不显示失败。新轮次开始由 Host 清除旧错误并进入 `running`，
角标恢复运行状态；成功结束后按既有未读规则显示。

Host 的 AcpSession/摘要是唯一状态所有者；侧栏 hook 从原有按 workspace identity、
path、attachment 和 service 隔离的订阅投影 `status` 与有无 `error`，不保留错误正文、
不新增 UI 状态或命令。相同 `status` 下错误变化也必须触发投影，旧 Host/旧 revision
不能覆盖当前摘要。归档列表仍只显示品牌图标，不加运行状态角标。

```text
ACP 执行失败 → Host 保存 interrupted + error → scoped summary 广播/重连读取
                                            → 侧栏投影：失败 > 未读 > 运行 > 无角标
新一轮准入 → Host 保存 running + error=null ─┘
桌面 continuous / 手机 replayable：只读取各自已有的 Host 摘要，不另建状态
```

验收：真实侧栏订阅及会话行测试覆盖失败且未读、无错误的 interrupted、主动停止、
新轮运行、成功/未读、同状态错误变化、跨 Host 隔离和迟到快照。项目/工作树、置顶、
时间线以及桌面/375px、Zai 浅深主题中检查红点可见、标题位置和行高稳定；
不向 Host 发送写命令，也不读取 Agent。

## 当前会话选中反馈

侧栏 API/ZCode 与 ACP 会话的当前行参考待办任务卡片：使用 `icon-blue` 蓝色内边线、
左侧短标记和 `accent` 底色，选中后悬停仍保留这一样式。未选中行只显示原有 hover
背景；键盘焦点有独立焦点轮廓，不能把 focus 当作当前会话。项目、工作树、置顶区、
时间线及原生分组列表使用同一展示规则；拖动预览不显示当前行选中标记。

选中仍由既有 workspace identity/session/task owner 决定，读取原有 `isActive`/`active`
投影，不添加状态、缓存、写入、RPC 或导航分支。标记不可点击、不进入 Tab 顺序，
边线使用不占布局的 inset shadow，保持行高、标题左边缘和右侧置顶/归档操作位置。
API 与 ACP 当前行均提供 `aria-current="page"`。父项目展开不等于会话选中。

验收：真实 API/ACP 行和分组行，在桌面/375px、Zai 浅色/深色主题下验证计算底色、
蓝色边线/标记；鼠标选择、Enter/Space 切换选中、悬停/聚焦与右侧操作不移动内容。
截图使用模拟会话数据，禁止为展示效果改动真实用户历史。归档/置顶继续走原有路径。

### 当前窗格与跨项目选中投影

会话当前项由可见布局的焦点绑定决定：激活 workbench group 时读取该 group 的焦点
绑定，否则读取临时 pane layout 的焦点绑定；只有焦点是未绑定的主窗格时，才读取
Shell 原有 native task / ACP 主会话投影。关闭主窗格后剩余 pane 不改名或提升，
即使仅剩一个 secondary pane，也从它的绑定得到当前项。主窗格为草稿、焦点 pane
尚无 session、只读子会话或恢复绑定尚未验证时，不高亮任何会话，不回退到旧主会话。

投影包含真实 workspacePath、workspaceIdentity、remoteSessionId、会话类型和 ID；
identity key 仍是 `workspaceIdentity?.trim() || workspacePath`。native 与 ACP 的 ID
分别投影，不能将 ACP ID 写进 native store。普通项目、工作树合并列表、时间线、
置顶和任务区读取同一投影；同路径不同 Host、同 ID 不同类型不能同时高亮。操作目标、
文件树、命令 cwd、Host 连接和现有选择命令仍用原有路由，投影不驱动业务写入。

```text
会话点击 / 窗格焦点 / 关闭窗格 → 既有 group 或 pane layout owner
                                  → 只读当前绑定 → 侧栏统一选中投影
主窗格且无显式绑定 → Shell 当前会话 ───────┘
Desktop / 普通 Web：读取 renderer-local 布局；手机 replayable：沿用单主窗格当前会话
```

补充验收：真实布局 owner 的跨项目 native/ACP 切换、同路径不同 identity、分组焦点、
关闭主窗格剩单窗格、草稿与只读/待验证恢复、返回主窗格及新建草稿重置。渲染 E2E 必须
从 owner 变更得到选中投影，而非直接给行组件伪造 `active=true`；同时验证浅深主题、
375px、普通项目与工作树合并/时间线/置顶列表，原 owner 无额外 session 创建或 RPC。

### 待办页面与外层会话选择（issue #85）

进入待办页面时，外层侧栏的 API/ZCode 和 ACP 会话均取消当前项高亮与
`aria-current="page"`，包括普通项目、工作树、置顶、时间线及原生分组列表。
即使后台保留主会话或激活的分屏 group/secondary 绑定，也不将它们投影成当前页面。
待办页自身的任务卡片和会话选择继续由 `workTaskNavigationStore` 持有。

主视图继续由 Shell 的既有 `workspaceMainView` 持有，侧栏读取现有
`workTasksActive`，同步控制只读会话选择投影，不通过 effect 清空 session、布局或
持久化导航。再次点击外层会话（含原先选中的同一会话）沿用原有导航切回聊天，
此时才恢复真实当前窗格的高亮；置顶、归档等行内操作不激活外层会话。
本次不改变其它主视图的选择语义，不增加协议、Host 写入或数据迁移。

```text
打开待办 → Shell workspaceMainView=work-tasks → workTasksActive=true
       → 侧栏只读投影：两个会话 ID 均为空（原会话/分屏绑定保留）
点击外层会话 → 原有选择命令 + Shell 切回 chat → 投影恢复当前窗格
Desktop / Web / 手机：同一 UI 投影；连续流与 replayable 恢复链路不变
```

验收：先补充投影单测与真实侧栏 E2E，验证 native/ACP 主会话、激活分屏组和
临时 secondary 在待办页面均无外层当前项；点击同一会话或其它会话后恢复唯一当前项。
覆盖项目/时间线/置顶列表、桌面/375px 和 Zai 浅深主题，并确认布局绑定、任务导航
与 Host 状态没有额外写入。

## 时间显示

侧栏中 API/ZCode 与 ACP 的会话行均不显示标题后的相对时间，包括项目与工作树合并列表、分组列表及拖动预览、时间线、置顶区和归档列表。移除时间文案及其空占位，不新增设置开关。时间线原有日期分组标题保持现有规则。

这是 UI 展示调整：Agent 图标、未读与运行状态、定时/闲时任务标记、变更摘要、置顶、归档/恢复/删除等操作、工作树标记和会话跳转仍复用原有组件及服务。会话行在静止、悬停、聚焦、确认归档和触屏状态下均不显示时间，归档按钮出现时不得改变行高或标题左侧位置。

原生 task service 与 ACP Host 继续唯一持有 `createdAt`、`updatedAt` 和 legacy 时间投影。创建/最近活动排序、时间线日期分组、分页、搜索及持久化不变，不清零或改写时间，不新增缓存、RPC 或状态写入路径。聊天消息、调用轨迹、工作流及搜索结果中的时间显示不属于本次调整。

## API 会话图标

API/ZCode 会话在标题左侧显示该会话实际使用的模型供应商图标，与模型设置页面使用同一 `ProviderLogo` 组件及配置中的 `logo`，尺寸与 ACP 图标统一为 16px。项目、工作树、时间线、置顶、原生分组与拖动预览以及归档会话使用同一展示组件。供应商身份只从该行既有 `task.model` 经共享 `parseModelPickerValue` 解析取得，不能使用执行后端 `task.provider=glm`、输入框当前选择、标题、API 格式或其它会话推断供应商。匹配供应商的 `effectiveConfig.logo`，即使供应商或模型已停用，历史行仍显示其配置图标。

本地会话复用根节点已加载并订阅的 Provider Settings 快照，不逐行读取供应商或会话。远程行通过既有 workspace identity/Host 解析和 Provider Settings hook 读取所属 Host 的配置；远端未连接、切换 Host 或读取失败时显示默认图标，不借用本机或旧 Host 的配置。没有模型信息、旧格式无法解析、供应商已删除、没有配置图标或素材加载失败时，使用与模型设置一致的默认包图标。供应商配置更新及该行模型元数据更新直接重新投影图标，不新增持久化字段、独立供应商缓存或模型连接。

Provider Settings hook 在切换 Service 的 effect 中先同步更新同一 owner 引用，再订阅和读取新 View；新 Host 的快速响应不必等待 React 提交 loading render 才能通过 owner 守卫，旧 Host 的响应仍由 service/generation/revision 拒绝。不能以延时补偿这一事件顺序。

活动列表保留原有状态所有者和优先级：`deriveTaskLeadingIndicator` 读取已有 task membership 与 sessions-index activity，按错误、未读、实时运行状态投影到图标右下角；没有状态时只显示品牌图标，时间线不再出现额外灰色空闲点。历史 `status=running` 没有实时 activity 时仍不显示旋转状态。hover、focus 和右侧归档确认不会替换或隐藏品牌和角标，状态变化不增加行高或移动标题。分组行的状态随品牌移到左侧，右侧不重复显示相同状态；手机远控激活任务保留原有手机标记优先规则。归档行只显示品牌身份，仍由原有归档恢复/删除入口处理动作。

```text
既有 task membership + sessions-index activity → deriveTaskLeadingIndicator
                                                → 单一状态角标
会话 task.model → 共享解析器 → 所属 Host 的 Provider Settings → 既有 ProviderLogo
本地：根快照已订阅 → 只读 logo；远程：identity 解析 → Host hook 订阅/读取 → 当前 revision
归档列表 → 对应供应商图标；右侧动作 → 既有 task service
```

这是 UI 展示投影，不新增持久化字段、状态缓存、RPC 协议、模型连接或会话创建。所有图标使用仓库已有供应商素材，深浅主题与窄屏均可辨认，身份图标不加入 Tab 顺序，原有会话导航及右侧置顶/归档/工作树互斥规则保持一致。

## 等待响应指示器颜色

API/ZCode 与 ACP 会话图标右下角的旋转圆环统一使用黄色，浅色主题使用 yellow-600，深色主题使用 yellow-300；默认与 Zai 主题均遵循此规则。共享语义 token 为 `--color-task-running-indicator`，不复用 Zai 中呈橙色的 warning token。等待圆环及底板尺寸由 14px 缩小为 10px，保留原有圆环形状、3px SVG 描边、2px card 底色隔离环、右下角定位、16px 品牌图标、旋转动画与显示优先级。未读和错误角标维持原尺寸，状态切换不移动标题或增加行高，等待角标不得覆盖标题。这里的等待指运行/预热中的响应等待，不改变权限或问答的“等待确认”胶囊。

状态仍由原生 sessions-index activity 或 ACP Host 持有，组件只投影颜色和尺寸，不增加状态、写入路径或协议，无数据迁移。错误与未读优先级、历史 running 无实时 activity 不显示动画的规则不变。复用现有图标 E2E，在桌面/窄屏和 Zai 浅色/深色主题下断言真实计算颜色为对应黄色、圆环与底板尺寸为 10px、描边为 3，并检查旋转和底色隔离；检查角标不覆盖标题、状态切换及 hover/focus 不影响身份和布局。

## 置顶与归档布局

API/ZCode 和 ACP 的项目、工作树、时间线与置顶会话行，将置顶/取消置顶按钮移到右侧，与归档按钮并排放在同一个操作组。组内顺序为原有文件树入口（如有）、置顶/取消置顶、归档/归档确认。普通图标按钮统一复用 `TaskRowActionButton` 的 24px 尺寸、悬停背景、提示和 2px 间距。

悬停、键盘聚焦和触屏无 hover 环境显示置顶与归档；归档确认期间保留操作组。普通已置顶行在静止状态下也保留右侧取消置顶入口。工作树行在静止状态下只显示右侧工作树标记，不同时显示置顶按钮；悬停、键盘聚焦、触屏或归档确认时，隐藏该标记，由既有置顶/取消置顶和归档操作占用右侧区域。离开 hover/focus 且没有确认状态后恢复标记；置顶区和时间线遵循同一规则。标记是不可操作的身份展示，不加入 Tab 顺序，工作树身份及真实路径通过会话行的无障碍描述保留，避免聚焦图标后隐藏图标导致焦点丢失。

既有只读、busy 和待交互限制保持原有语义，不能通过布局变化绕过禁用状态。左侧保留会话自身的智能体品牌与状态角标，或既有手机标记，不再出现可点击的置顶按钮或置顶角标；悬停或聚焦不能替换这些图标。按钮出现或进入归档确认时，行高与标题左边缘保持稳定。展示条件直接复用行的 hover/focus/no-hover/归档确认状态，不新建延时、持久字段或并行可见性状态。

这是会话行的局部展示调整；hover/focus 与归档确认继续由原有行/列表持有。置顶沿用原生 task service 或目标 Host 的 `IAcpService.updateRow`，归档仍沿用各自的确认与命令路径。点击置顶应取消该行的归档确认，不触发会话选择、创建、连接或登录。任务排序、持久化、远程 identity 与 Host 归属不变；原生分组列表的“移至最上”仍是分组顺序操作，不改成置顶。

API 与 ACP 的归档图标和确认态使用同一个按钮 DOM，只更新文案与样式。移除正在悬停的按钮会丢失 mouseleave，使行的 hover 状态残留；不能用延时或第二份 hover 状态补偿，应复用现有共享按钮来保证离开和取消后恢复工作树标记。

## 验收

更新现有真实会话行和混合列表 E2E：在桌面及窄屏、浅色及深色主题下，API/ACP 会话行均无相对时间；图标、工作树标记、归档确认和键盘/触屏操作保持可用。切换按创建时间与更新时间排序仍得到原有次序，置顶仍进入既有置顶区。当前桌面窗口只通过读取与悬停验证，不更改用户历史。

补充布局验收：API/ACP 两种行及其时间线、置顶变体的右侧置顶和归档同组、同高并相邻，置顶在归档左侧；左侧没有置顶按钮，智能体及状态在 hover/focus 时可见。工作树行在静止时显示末尾标记（包括已置顶行），hover/focus/归档确认/触屏时只显示操作组；鼠标移开但焦点仍在行内时保持操作组，真正离开后恢复图标，取消确认后亦恢复。检查标记不进入 Tab 顺序、行的无障碍描述含真实路径、标题位置和行高稳定、键盘与触屏置顶、busy/只读禁止写入和无横向溢出。按钮动作仍只发送给各自的原有所有者。

补充图标 E2E：真实原生会话行在项目、时间线、置顶、分组、拖动预览与归档列表中均显示 16px 对应供应商图标，与模型设置渲染的素材一致。桌面及窄屏、浅色及深色主题下检查不同供应商、同模型名不同供应商、供应商停用/改图标、缺少或无效模型信息及未配置供应商的默认图标，并检查 idle、legacy provider 缺省、error、unread、running/prewarming、历史 running 无 activity 的状态。切换输入框模型不改变历史行；更新某行自己的模型只改变该行图标。本地供应商只读一次根快照，远程同路径不同 identity 的行使用各自 Host 图标，断连不混用本机，Host 换代的旧响应不覆盖新图标。hover/focus 时品牌及角标保留，只有一个状态角标且按既有优先级显示；不同任务与 ACP 会话互不影响。混合列表 API/ACP 标题对齐、置顶归档与工作树切换无回归，测试使用 fake Host，不连接模型或更改用户历史。
