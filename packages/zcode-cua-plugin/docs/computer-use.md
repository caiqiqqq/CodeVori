# 电脑控制

使用 Open ZCode Computer Use 控制本地 macOS 14+ 应用。需要为启动控制进程的
ZCode 应用授予辅助功能和屏幕录制权限。Windows、Linux 和远程工作区不支持。

此插件提供普通 stdio MCP；API/ZCode 和支持该传输的 ACP 智能体通过已有插件能力
加载它。启停后使用新连接。不会获取官方 CUA broker 特权，也不提供官方画中画。

工具循环保留 `观察 -> 一次操作 -> 再观察`。state_id、frame_id 只属于当前连接，
不要重用历史对话中的引用。操作失败时检查发送状态；可能已发送的输入不能盲目重试。
同一桌面上的并发操作会返回 busy，避免两个会话交叉控制。

MIT 来源和本地修改记录随插件的 dist/LICENSE、dist/NOTICE 和 dist/ZCODE-CHANGES.md
一起分发。源项目：https://github.com/hqhq1025/open-zcode-computer-use。
