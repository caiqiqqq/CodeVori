# 当天按小时的应用用量（issue #100）

## 产品规则

- 设置 → 使用统计 → 应用用量新增「今日每小时 Token 趋势图」，保留每日趋势与模型占比。今日以快照生成时间和请求的客户端 IANA 时区为准，显示 00:00–23:00 的 24 个小时。
- 小时图始终统计今日，与全部时间/近 7 日/近 30 日的选择无关；来源选择同时作用于两种趋势，全部来源包含 API 与各 ACP，ACP 模型仍带智能体名称。图例独立支持鼠标和键盘隐藏模型，Y 轴随可见模型峰值变化。
- API 沿用 `computed_total_tokens` 和 `started_at` 的事实口径；ACP 原生请求使用已确认请求时间，整轮报告使用已有 user entry 时间。无时间或无已确认 Token 的历史不可补算，不把日总量均分到小时，不把上下文容量当消耗。
- 时区偏移按每条时间戳计算，支持半小时时区和夏令时；夏令时回拨的重复钟点合并为同一个小时，跳过的钟点为空。未来时间、前一天和缺日期不进入今日图。
- 没有正用量的小时无模型点和 tooltip；今日没有数据显示空态，旧 Host 未提供小时字段显示「当前数据源暂不提供小时统计」，不能伪造零用量。
- 打开和手动刷新沿用现有 hook 和查询，不增加轮询、单独请求、业务缓存或持久化；跨午夜通过重新读取快照切换到新日期。桌面/手机窄屏、浅色/深色和中英文均可用。

## 所有者、接口与顺序

- CLI usage store 与目标 Host 的 IAcpService 继续分别拥有 API 与 ACP 事实；UI 只读派生图表及保存图例选择，不新增写入路径。
- `AppUsageSnapshot.hourlyModelUsage?` / `AcpAppUsageAgent.hourlyUsage?` 是 `{ date, hours: [{ hour: 0..23, models: [{ modelId, totalTokens }] }] }`，采用共享运行时 schema。缺省表示旧数据源不支持，空 models 表示该小时无可确认记录。`v4/usage/stats` 继续引用扩展后的同一 snapshot schema，无新命令。
- usage store 的只读查询附带最近 48 小时的模型请求时间/模型/Token，builder 通过共享纯时区聚合器筛选今日。查询读取已有表，不迁移数据库；48 小时涵盖夏令时变更日，且不扫描/传输全历史原始请求。
- UI 合并相同日期的小时事实，来源缺字段或日期不一致时显示不支持，避免跨午夜将两天数据合并。

```text
settings / useAppUsageStats（客户端时区 + range）
  → 目标 Host / IUsageStatsService
      ├─ CLI usage store → 最近请求 → 时区小时聚合 → native snapshot
      └─ IAcpService → 原生请求 / 已确认整轮 → 时区小时聚合 → ACP 分组
  → 同一 snapshot schema / 既有 RPC
  → 来源只读投影 → 小时趋势 + 每日趋势

desktop continuous attachment ──┐
mobile replayable attachment ──┴─ 查询同一 Host 的事实；小时图不新增 stream/queue
```

## 验收与验证

- 单测：午夜边界、同小时同模型求和、空小时、未知模型、未来/无时间排除、半小时时区、夏令时重复小时；API SQLite 查询→builder→schema；ACP 原生去重和整轮投影；全部/API/ACP 隔离、旧字段兼容、不修改输入。
- E2E：真实 AppUsagePanel 的小时曲线、tooltip、隐藏/恢复模型、键盘操作、来源/范围切换、空态/旧 Host 提示、刷新后跨午夜；1440px 与 375px、中英文、浅色与深色，无横向溢出。
- 执行根目录 typecheck、lint、architecture:check --changed 以及 CLI typecheck/lint，报告已有失败与实机验证边界。

## 本地验证记录（2026-10-13）

- Node 24.14.0 / pnpm 10.33.2；根目录与 CLI 类型检查通过，根目录 lint 0 错误、74 警告；架构检查 baseline/new 均为 0。
- 小时聚合、来源投影、每日图回归、ACP 小时投影及 SQLite → builder → schema 共 16 个目标单测通过。小时图 E2E 覆盖 1440px/375px、中文/英文、浅色/深色的 8 组组合。
- CLI lint 未通过：存量超长文件错误。使用 HEAD 源码在临时目录对照 adapters/bootstrap/cli/contracts，分别为 25/20/2/5 个错误，修改前后数量和错误种类一致。
- 原有 ACP 累计测试在重启后向已归档会话发消息，触发 `Restore the archived conversation before sending`；替换为 HEAD 版本的用量聚合器后复现相同失败。本任务不改变归档发送规则。
- 小时图和原有每日趋势 E2E 均通过，使用真实 UI 组件和合成服务响应。
- 已构建并启动桌面开发版，使用独立开发数据目录；实际使用统计页面成功读取历史快照并显示小时图，今日无可确认用量时显示空态。未进行真实付费模型调用，手机实机链路尚未验证。
