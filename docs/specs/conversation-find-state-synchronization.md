# 对话查找状态同步

## 产品规则与所有者

- API 和 ACP 历史会话继续使用共享 ConversationTimeline、查找和滚动容器。
- App 是查找 query、activeIndex、navigationRequestId 的唯一所有者；时间线只上报派生的 matchCount 和 activeIndex。不新增会话状态、缓存、协议或重试定时器。
- `changeTaskFindSelection` 接收相同 query 和 activeIndex 时返回原状态，不能仅因新的结果对象就产生更新；选择变化不递增 navigationRequestId。
- `navigateTaskFindSelection` 是主动导航命令，即使 query 和 activeIndex 相同也递增 navigationRequestId。单命中环绕仍需重新定位。
- 会话订阅未完成、首帧没有 rows、历史补页或流式内容更新时，相同查找结果不得形成上报、父级渲染、时间线布局更新的反馈循环。
- 保留原有滚动记忆、底部跟随、用户上滚和回到底部行为。错误边界继续显示真正的错误，不隐藏错误或延迟同步来绕过循环。
- 只改变 renderer-local 查找状态转换，不修改 Host admission、desktop continuous 或 mobile replayable 会话数据链路。

```text
Host 会话快照 / 尚未到达的空 rows
    -> 时间线派生查找结果
    -> App 使用 changeTaskFindSelection 同步
        -> 值相同：原状态，停止反馈
        -> 值改变：一次状态转换 -> 共享时间线渲染与滚动同步

用户点击下一项 / 上一项
    -> App 使用 navigateTaskFindSelection 递增请求身份
    -> 时间线重新定位（单命中也生效）
```

## 验收

1. 纯逻辑测试覆盖重复同步的引用相等性、query/index 分别改变、navigationRequestId 保留，以及同一匹配主动导航的递增。
2. E2E 使用真实 ConversationTimeline 和 App 的状态转换路径，首帧订阅未完成时每次渲染提供新的空 rows；不得出现 Maximum update depth exceeded，渲染应在无新输入时停止。
3. rows 后续到达、API/ACP 会话切换、查找结果改变和清空后仍可呈现正文、导航和底部跟随。上滚后内容变化不得强制贴底。
4. 在窄屏和桌面、明暗主题验证上述同步，并确认不发送模型请求或创建真实 Agent 连接。
5. 重载真实桌面窗口并打开已有 API 与 ACP 历史，确认时间线和输入框可用、菜单可打开；执行 typecheck、lint 和架构检查，报告实际结果。

## 原因证据

历史恢复的空 rows fallback 每次父级渲染都是新数组，时间线据此重新派生并上报空查找结果。原 `changeTaskFindSelection` 对相同 query/index 仍返回新对象，使 App 更新继续反馈到空 rows。真实窗口在 scrollTop、scrollHeight 和 clientHeight 未变化时连续执行 53 次滚动写入，最终在时间线的布局同步中触发 React 嵌套更新上限。状态同步必须幂等；滚动函数中的相等性判断不能替代上层状态所有者的幂等转换。
