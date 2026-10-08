# 分屏面板关闭

## 产品规则

- 两个及以上面板时，每个面板（包括主草稿 `workspace-main`）显示现有关闭按钮。
- 普通关闭只移除指定面板、塌缩其父分割节点；剩余面板自动填满空出的空间。
- 保留存活面板的 paneId、workspaceScope、native/ACP 类型、Agent、只读和恢复标记；不提升或重新编号，不重挂载对话，不清空输入草稿。
- 当前焦点未关闭时保持焦点；否则优先选择存活的主面板，没有主面板则选择树中第一个存活叶子。
- 仅剩一个面板时隐藏关闭按钮，重复关闭或关闭不存在的面板不改变状态。普通关闭最后一个面板是 no-op。
- 关闭布局不删除、归档或停止会话，不执行 ACP 创建、认证或模型请求。真正的删除、归档和恢复验证发现会话不存在使用 `session-removed` 原因：最后一个绑定移除后回到主草稿。
- 关闭主面板后不强制补空白草稿；原会话组即使只剩一个绑定仍拥有该面板，直到用户新建任务、选择其他会话或该绑定被删除。新建任务继续走原来的退出组、重置布局、创建草稿路径。
- 项目与任务列表的跨 workspace、API/ACP 混合选择与分屏遵循 `workbench-cross-workspace-split.md`；打开另一边或关闭后切换焦点不能使原 ACP 主会话退回空白草稿。

## 状态所有者与接口

临时草稿布局由窗口级 `paneLayoutStore` 唯一持有；显式会话组由 `workbenchGroupStore` 唯一持有。可见组优先于临时布局，不向 shell 复制会话绑定。主面板关闭后，临时树可不含 `workspace-main`；会话组的 `primaryBinding` 为 null，当且仅当树中没有主面板。

```text
关闭按钮 / 会话移除确认
  -> WorkbenchLeafPane（dismiss / session-removed）
  -> V4WorkspaceChatArea 选择当前布局所有者
  -> store 原子移除叶子、绑定和会话索引，计算存活焦点
  -> 同步存活 native 会话的 shell 导航（ACP 不进入 native 选择接口）
  -> 扁平 keyed pane 更新矩形 + 本地持久化
```

`closePane` 和 `closeWorkbenchGroupPane` 共用纯树转移，默认原因是 `dismiss`。`session-removed` 只用于已确认的删除、归档或不存在，不受最后一个面板保护。不会新增超时、远端命令、第二份会话事实或业务缓存。

## 持久化与边界

- 兼容现有布局 v2 与会话组 v1；允许合法无主面板树和单叶子会话组。主面板仍不进入 panes map。
- 叶子唯一、数量不超过四个、每个非主叶子必须有合法绑定；含主叶子的组必须有合法 primaryBinding，不含主叶子的组不能保留已关闭的 primaryBinding。
- 无效焦点回落到实际存活叶子；刷新时逐绑定验证存在性，不恢复已关闭的主草稿。冷启动仍进入原主草稿。
- workspaceIdentity 优先于路径；remoteSessionId、ACP kind/agent 和原有恢复验证语义不变。
- 本次变更仅涉及 renderer-local 布局与导航，不改变 Host owner/lease、Desktop continuous 或手机 Web replayable 协议。手机远控继续单列并禁用桌面会话组。

## 验收

1. 主草稿 + API + ACP，关主草稿后保留两会话、原 paneId、正文与输入；焦点落在存活叶子，无新模型请求。
2. 两面板关闭任意一个后，剩余面板占满容器且没有关闭按钮；再次关闭为 no-op。
3. 会话组关闭主面板、关闭 secondary、重复关闭、同 ID 不同 native/ACP、跨 identity 时绑定与索引准确。
4. 无主面板布局和单叶子组刷新可恢复；已删除/归档的最后一个绑定被清理而不是卡在最后面板保护中。
5. 主面板已关闭时，侧栏选择替换或聚焦存活面板，继续拆分和草稿首次发送可绑定，不重新引入主草稿；新建任务仍恢复独立主草稿。
6. 真实布局和面板组件的浏览器测试覆盖宽/窄屏、浅/深色、焦点、输入保留及零重挂载；Host 和模型边界使用合成替身，不触碰真实历史。
