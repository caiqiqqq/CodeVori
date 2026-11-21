# 智能体与小队设置页

## 产品规则

- 将智能体档案（`agentProfiles`）和小队（`squads`）合并为一个“智能体与小队”设置入口；入口内采用参考 Multica 团队页的分组导航和主内容列表，不使用页顶横向 tabs。
- 内部侧栏分为“智能体”和“小队与成员”两个分组，分别导航到智能体档案和小队列表；计数仅显示当前数据源真实记录数。
- `SubagentsSection` 不属于本次合并；`delegation` 继续遵循主分支的独立导航和隐藏策略，不映射到合并页。
- 复用 `AgentProfilesSection`、`AgentSquadsSection` 及其 hooks、服务和持久化，不新增业务写入路径。切换分段只改变局部 UI 选择。
- `agentProfiles` 是合并入口的规范 ID；旧 `squads` 意图进入同一入口并选中“小队”。显式 `agentProfiles` 意图选中“智能体”。冷启动与已打开页面都遵守同一规则。
- 普通打开合并页默认显示“智能体”；上次保存的旧 `squads` 位置仍可恢复到“小队”。导航意图消费后不应影响后续打开。
- 主列表保留创建、编辑、删除及错误/加载/空态；不展示当前服务数据不支持的在线状态、运行时长或运行次数。
- 使用主题语义色、`text-ui-*` 字级、宽内容容器，兼容桌面及窄屏 Web、中英文。

## 智能体创建与编辑表单

- 参考 Multica 配置页，表单在主内容区居中、最大宽度 832px，按“身份”“行为与能力”“执行配置”组织为独立卡片；同一布局用于新建、编辑及小队内新建智能体。
- 身份包含名称和说明：桌面采用标签/输入两列，窄屏上下排列；说明使用多行输入并显示 1000 字上限。行为卡片提供较大的职责提示词编辑区，保留 12000 字上限。
- 执行配置包含既有运行时/API 模型选择、API 思考强度和 ACP 模型选项/刷新，ACP 未显式选择时继续使用运行时默认值。只展示当前协议可保存的字段。
- 操作区使用带顶部分隔线的粘性底栏，取消放弃当前草稿，保存遵循原有必填/忙碌/目标可用性校验。冲突保留全部草稿，成功后回到列表或返回原小队编辑。
- `ProfilesContent` 或 `SquadsContent` 继续唯一持有草稿，`AgentProfileEditor` 接收受控值并通过 `onChange` 更新；`useAgentSquads` 是保存命令的唯一入口，不改变持久化、版本冲突或 workspace 路由。
- 验收：1280px/375px、浅色/深色下分组可读且无横向溢出；必填未满足不能保存；取消后再次创建为空白；API/ACP 配置和说明经编辑/保存后保持；小队内创建保留小队草稿。

## 状态所有者与接口

- `SettingsPage` 是一级设置 section 和内部 `AgentSettingsView` 的唯一状态所有者；`AgentsAndSquadsSection` 是受控展示组件，持有该页当前的二级导航选择。
- `settingsNavigation` 保留旧 `SettingsSectionId` 输入，通过 `resolveSettingsSection` 将 `squads` 映射为 `agentProfiles`；原始意图用于选中分段。
- `AgentProfilesSection` 和 `AgentSquadsSection` 仍通过原有 hooks 读写服务端配置；局部选择不写入服务端、不复制配置。
- 存储不可用时沿用现有安全回退，不影响通过同窗口事件导航；本次不改变远程 workspace 身份、同步或委派语义。

```mermaid
sequenceDiagram
    participant Nav as 导航意图
    participant Page as SettingsPage（唯一 UI 状态所有者）
    participant View as 分组导航与列表
    participant Config as 原有配置组件与 hooks
    Nav->>Page: agentProfiles / squads
    Page->>Page: squads 归一为 agentProfiles，并选中 squads 分段
    Page->>View: view 与 onViewChange
    View->>Config: 按分段渲染原有组件
    Config->>Config: 沿用原有服务读写配置
```

## 验收场景

1. Web、macOS、Windows 的设置配置均只保留一个档案/小队入口；子智能体入口与主分支的协同隐藏策略保持独立。
2. 页面分段能切换到真实的智能体档案和小队内容；新建、编辑、删除、冲突、远程不可用行为继续由现有组件处理。
3. 冷启动和已挂载时的 `squads` 意图均定位“小队”；`agentProfiles` 意图定位“智能体”。消费一次性意图后不残留。
4. 1280px 与 375px 下页面没有横向溢出，两个分段均可访问；中英文标签正确。
