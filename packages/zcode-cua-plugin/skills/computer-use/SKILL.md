---
name: computer-use
description: 在本地 macOS 上操作桌面应用，读取辅助功能界面、截图、点击、输入和验证操作结果。
---

# 电脑控制

通过此插件的 `computer-use` MCP 工具操作本地 macOS。不要使用浏览器控制工具替代
原生应用操作，不要写 AppleScript、shell 或其他控制脚本绕过这些工具的状态校验。

先调用 `request_access` 读取权限；缺失时请用户在 ZCode 设置的电脑控制区域完成授权。
该工具不会自动弹系统权限窗口。仅支持 macOS 14+；其他平台停止并说明不支持。

用 `list_apps` 取得真实 app 标识，用 `open_application` 和 `list_windows` 定位目标。
调用 `get_app_state` 后根据辅助功能节点选取元素；界面无法语义定位时才使用最新截图
中的坐标和 frame_id。每次只执行一次操作，再重新观察。不得从历史文本猜测元素、窗口、
state_id 或 frame_id，不得在动作已消费后复用旧引用。

优先使用 `left_click`、`set_value`、`select_text`、`perform_action` 等 AX 操作；键盘
和输入必须绑定目标 app/window。物理指针接管、mouse_move、分离按下/抬起未启用。
不要把原生进程接受事件当作任务已经完成，应检查实际界面结果。

多个会话争用桌面会返回 `computer_control_busy`，等待用户或其他操作结束，不循环
抢占。`stop_computer_control` 在当前连接中永久锁存；用户明确要求恢复后重新打开
连接。子智能体不能操作电脑。取消或发送状态不明时不要自动重试可能已发送的输入。

保持现有智能体工具审批。涉及发布、发送消息、购买、删除或其他不可恢复副作用时，
必须有用户授权。不要将完整剪贴板、截图中的秘密或无关个人内容写入日志。
