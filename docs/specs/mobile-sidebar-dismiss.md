# 手机侧栏外侧点击收起（issue #181）

## 行为与边界

- Web 工作区实际宽度小于 768px 且外层侧栏展开时，主内容区显示轻遮罩。点击或轻触
  遮罩只收起侧栏，不触发底下的导航、发送、输入框聚焦等操作。再次点击主内容时正常操作。
- 侧栏内部点击、滚动和 portal 菜单仍走原有交互；顶部侧栏按钮仍可展开/收起。
- 收起不卸载主内容，不清空草稿，不切换当前页面、项目或会话。
- 桌面客户端及宽度至少 768px 的 Web 保持原有并排交互。窄屏首次自动收起规则不变。
- 遮罩尺寸以 workspace shell 容器为准，随横竖屏或容器宽度变化立即更新；不存储另一份
  mobile/open 状态，不新增全局点击监听、超时、服务接口或协议。

## 状态所有者与事件顺序

`useAppPanels.isSidebarVisible` 继续是唯一显隐状态；`WorkspaceShellLayout` 仅基于
现有 props 和 CSS 容器查询投影遮罩，经 `handleToggleSidebar` 发出原有显隐命令。
遮罩提供中英文无障碍收起名称，支持键盘激活，使用现有主题色。

```text
窄屏 Web + sidebar visible → Shell 主区遮罩
点击遮罩 → 命中遮罩按钮（底层无点击/聚焦）→ handleToggleSidebar
         → useAppPanels visible=false → 移除遮罩 + 侧栏收起 → 主区恢复交互
侧栏内部/portal 菜单 → 原有操作；不经过遮罩
桌面 continuous / 手机 replayable → 仅本地 UI 显隐，无 Host/会话写入
```

## 验收

使用真实 Shell、显隐 hook、顶部按钮及应用 CSS 的浏览器 E2E（其它内容使用合成 fixture）：
320/390/767px、768px 边界和桌面宽度，Zai 浅深主题、中英文；轻触主区空白、底层按钮
及输入框位置只收起，后续点击可操作且草稿和 DOM 保留；侧栏内部及 portal 菜单不误收起；
顶部按钮可再次展开/收起；键盘激活遮罩；宽屏 Web/窄屏 Desktop 无遮罩且并排操作可用；
容器宽度变化、横竖屏切换无残留阻挡。浏览器模拟不作为 iOS/Android 实机验证。
