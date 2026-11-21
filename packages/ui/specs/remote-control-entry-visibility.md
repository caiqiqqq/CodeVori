# 远程控制入口显示规则

## 行为

- Desktop 工作区侧栏底部不显示“移动端远程控制”入口。
- 隐藏范围仅限侧栏按钮；远程控制弹窗、Bot Channel 配置及其服务实现继续保留。
- Web 端及其他位置不因本规则改变。

## 所有权与边界

- `WorkspaceSidebarFooter` 是侧栏底部入口的显示所有者。
- `WorkspaceWebRemoteControlTrigger` 继续封装入口和弹窗交互，不承载新的状态或服务路径。
- 本变更不修改远程 workspace、Host attachment 或会话运行时行为。

## 验收

- Desktop 主工作区的侧栏底部不渲染远程控制按钮。
- 设置页共用该 footer 时也不出现按钮。
- 远程控制触发器组件及弹窗实现仍在代码中保留。
