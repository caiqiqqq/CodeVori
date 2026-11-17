# 侧栏底部工具入口与列表可读性

## 产品规则

- 手机远控与设置入口移到侧栏最左侧窄工具栏底部，手机在上、设置在下。列表底部不再保留原来的横排操作区。
- 当前检出版本尚无截图中的独立窄导航栏；本次仅为这两个现有入口补充窄工具栏，不调整其余导航动作、顺序和文案。
- 工作区列表在顶部、中间和底部滚动时均不使用渐隐遮罩；边缘条目保持完整对比度，保留原生滚动与分组拖拽所需的 `overflow-anchor: none`。
- 桌面有工作区路径时展示手机入口，普通 Web 不新增手机远控入口。设置在桌面和手机 Web 均可访问。
- 设置页复用的账户/返回 footer 保持原有横排布局；工作区文件树仍覆盖原侧栏区域。

## 所有者与接口

- `WorkspaceSidebar` 只负责窄工具栏与列表的布局，不增加业务状态。
- `WorkspaceSidebarFooter` 增加可选的 `layout: "footer" | "rail"`，默认 `footer` 保持设置页兼容。
- 手机入口继续由 `WorkspaceWebRemoteControlTrigger` 持有弹层开关，按原样传递 `workspacePath` 和 `workspaceIdentity`；设置继续调用 Tab store 的 `openSettingsTab`。
- 移除仅服务于渐隐的 state、scroll/resize 监听和 ResizeObserver，不改变任务队列、Host 路由或远控链路。

## 验收场景

1. 桌面宽/窄侧栏中两个按钮纵向位于最左侧底部，不与列表重叠；设置按钮鼠标和键盘均可打开设置，手机按钮仍打开原远控弹层。
2. 长列表滚动顶部、中间和底部时 `mask-image` 与 `-webkit-mask-image` 均为 `none`，末项可滚动到视口内并点击。
3. 手机 Web 仅显示设置入口，触摸可用；中英文、浅色和深色主题下布局无横向溢出。
4. 默认 footer 仍是横排；打开文件树后主侧栏工具与列表一起切走。

## 验证入口

- `node packages/ui/test/sidebarUtilityRail.e2e.mjs`：真实侧栏与 footer 的浏览器场景，模拟外部服务，不连接用户的 Host 或远控设备。
- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`。
