# 机器人任务通知（issue #185）

## 产品规则

- 每个机器人新增独立的“任务通知”开关，旧配置默认关闭。开启后向已绑定的私聊对象发送普通 API 会话、ACP 会话和待办的完成、失败、等待确认提醒。只发送事件标题和任务标题，不发送完整回答、工具参数、问题正文或文件内容。
- 沿用机器人允许的工作区范围；远程工作区严格使用 identity，本地使用 path fallback。微信、飞书、Lark、Telegram 和配置了出站地址的 Webhook 可用；规划中的渠道不能开启。
- Telegram/飞书/Lark 使用已绑定用户；微信必须在当前登录凭据下收到过私聊消息，保存该私聊目标及最新 context token。凭据变更后旧目标不可用。不把扫码返回的机器人 id 当成收件人。Webhook 使用已有出站地址。
- 配置页显示绑定要求，提供“发送测试通知”，测试结果只在真实投递成功后显示成功；失败保留机器人投递错误。测试不启动 Agent。
- 系统通知开关、声音和窗口聚焦策略不影响机器人通知。机器人开关不改变已有对话回复或定时任务回推行为。
- 仅观察已经打开的项目；项目关闭、应用/Host 不在线时不承诺推送。不新增后台服务、任务队列或历史补发。

## 所有者、接口与顺序

任务事实仍由原 Host API/ACP/WorkTaskService 所有；UI 复用现有实时通知观察器，只保存观察边沿。窗口基础 Host 的 BotsService 是发送命令的唯一入口，通过 `notifyTask` 接受严格校验的 scope/source/taskId/eventKey/status/title/body；不访问远程文件或替远程工作区创建本地会话。配置仍通过 `saveBot` 写入 BotConfig。UI 只通过 hooks 访问服务。

```text
API sessions-index / ACP summary / WorkTaskService 事实
  -> 原 scope 观察器（首次/恢复快照只建基线、丢弃旧 revision）
  -> notifyTask(scope identity/path/attachment, source, taskId, 稳定事件 key)
  -> 基础 Host BotsService：读取当前配置/工作区权限/私聊目标
  -> 跨窗口共享文件锁原子认领投递收据 -> 原 provider.send
  -> 更新原 deliveryError；不回写任务状态

desktop continuous -> live edge ────────────┐
mobile replayable -> snapshot baseline ────┴-> 同一 Host 发送入口及收据
```

- 收据 key 包含 bot/收件人、workspaceIdentity.trim() || path、path、source、taskId、事件 key 和状态。attachment 贯穿请求，用于作用域隔离；同一个 identity 的多个 attachment 观察同一事件时共享收据。
- API 终态使用 lastActivityAt，等待使用 interactionId；ACP 终态使用最近用户 entry 身份，等待使用 requestId；待办使用 runSeq/status/updatedAt。待办绑定会话继续由原待办通知观察器负责，普通会话不重复通知。Bot 自身 activeTask 的回传不再叠加统一通知。
- 已确认的本地 Git 工作树分组仅用于选择待办绑定的读取 scope：工作树会话仍订阅自己的真实路径，但从主项目读取持久化待办绑定，按会话种类、id 和执行路径精确排重；普通工作树会话正常通知。关系未完成读取前不启动新 scope 的观察，不按路径名称猜测归属。
- 收据在网络请求前持久化，跨窗口并发只能一个请求认领。采用最多一次尝试，失败不自动重试（网络失败可能已送达），不影响任务和其他机器人。收据仅存 key 哈希和时间，最多 4096 条、7 天；不是可靠消息队列，超出保留窗口不保证去重。Host 重启保留有效收据。
- 微信私聊目标只由已授权入站私聊更新，凭据指纹匹配才可使用。一般 context 写入不能覆盖更新的通知目标；重置/解绑删除目标。
- 首次读、历史、重复状态、stale revision、恢复重连不补发；运行中的新一轮可再次通知。API/ACP 后台等待使用轻量摘要，不订阅完整历史。原系统通知行为保持。

## 验收

1. 旧配置默认关闭；独立开关持久化；未绑定/未激活、禁用、无出站地址、工作区越权或未知渠道零投递。
2. 各类任务完成、失败、等待事件；重复更新、不同轮次、同路径不同 identity、不同 attachment、跨 Host 并发、重启收据、网络失败不重发。
3. 微信目标与 token/context、重新登录后的旧目标拒绝；Bot 关联任务不重复通知；不泄露完整交互内容。
4. 真实通知 hooks + 配置组件的浏览器场景验证桌面和窄屏、两主题、中英文、系统通知关闭/聚焦仍可发送机器人通知、测试按钮成功与失败、首次/重连基线和旧 scope 失效。使用合成 Host/provider，不向真实账号发送消息。
