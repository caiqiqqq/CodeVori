# 项目名称别名

## 目标

用户可以为已打开的项目设置一个仅用于 ZCode 界面展示的别名。别名不改写文件系统目录、Git 仓库名、远端 workspace 路径或任务数据。

## 行为

- 项目行的更多菜单提供“重命名”入口，打开单行文本编辑对话框；提交前去除首尾空白。
- 非空别名替换项目在侧栏、项目选择和现有 workspace 标签投影中的显示名称；提交空白值会清除别名并恢复默认名称，取消或未提交不产生变化。
- 清空别名后恢复为 workspace 路径末段的默认名称；SSH 远端仍按既有规则追加连接 alias 展示。
- 别名按 `workspaceIdentity?.trim() || workspacePath` 关联，允许相同路径的不同远端分别命名；本地项目以规范化前的现有路径 key 保持兼容。
- 别名跨应用重启保留，并随设置服务的现有更新/广播机制在同一窗口与其他窗口刷新；旧设置缺少该字段时等同于没有别名。
- 远端 workspace 的别名写入本机应用设置，不发送到远端 Host；断连项目仍可改名，设置服务不可用时显示错误且保留原名。

## 所有者与边界

- `AppSettings.workspaceAliases` 是别名事实源，设置服务负责校验、串行合并和持久化；`useSettings` 在保存后发送仅通知重读的跨窗口广播，不广播别名快照。
- `TabStore` 只持有当前窗口 workspace 的 `label` 展示投影；恢复和设置变化时从 `workspaceAliases` 生成，不把别名写入 `lastWorkspaceSession`。
- 侧栏是命令发起方，通过现有 `useSettings` 提交 `workspaceAliases` 的单 key 补丁；Root 读取同一设置快照，按当前 tab 集合更新 TabStore 投影。其他 UI 通过 TabStore 的现有 label 读取，不创建第二份别名缓存。

```text
项目更多菜单 -> useSettings.update({workspaceAliases: {[key]: alias}})
  -> 本机 SettingService 串行写队列 -> 校验并按 key 合并（空串删除）-> 持久化
  -> 现有设置刷新/跨窗口广播 -> Root -> TabStore.label -> 项目显示入口
desktop-continuous / web-remote-replayable: 只更新展示投影，不修改会话传输或 admission
```

## 约束与失败语义

- 别名最多 200 个字符，必须是非空文本或删除映射；拒绝控制字符和路径分隔符，避免将展示字段误用于文件操作。
- 更新在同一设置服务实例的既有串行写队列内按 key 合并，保留该队列内同时发生的 `recentProjects`、会话恢复或其他别名更新；空串补丁只删除当前 key，持久化快照不包含空串。不同窗口 Host 的独立写队列沿用现有机制，本次不新增跨进程文件锁，也不保证独立 Host 同时写入时的全局串行化。
- 保存失败时不提交新的 TabStore label，提示本地化错误；设置广播到达旧 workspace 时不能改写新 workspace 的投影。
- workspace identity/path 是所有异步读写和投影更新的关联键；不按显示名匹配。

## 验收场景

1. 打开项目，更多菜单选择重命名，输入 `前端主站` 后确认，侧栏立即显示该名称，重启后仍显示；路径未变化。
2. 同一路径连接两个不同 SSH 目标，分别设置别名，切换后显示各自名称；清空其中一个只恢复该项目的目录名。
3. 取消不改变原名；空白输入恢复目录名；超长/含控制字符或分隔符输入给出校验提示；设置服务失败时保留原名。中文输入法候选确认不会触发保存，保存期间重复提交不会产生第二次写入。
4. 在另一窗口或设置广播刷新后，已打开 workspace 的显示投影更新；关闭再恢复 session 时别名仍按 identity/path 命中。
5. 运行别名 schema、workspace store 和设置持久化定向单测、UI E2E，以及 `pnpm typecheck`、`pnpm lint` 和架构检查。

## 本地验证

- 4 项定向单测通过：旧配置兼容、别名校验、identity 隔离、投影幂等、关闭后恢复，以及同一设置服务写队列内的补丁合并与文件持久化。
- renderer E2E 通过：取消、清空、保存失败、中文输入法、重复提交保护、外部设置刷新与项目选择显示；覆盖 1280px / 375px、浅色 / 深色主题。Host 使用模拟服务，未验证打包后的 Electron 或真实手机远控 attachment。
- `pnpm typecheck` 通过；`pnpm lint` 为 0 errors、74 warnings；架构检查无违规。
