# 议题与任务联动验证

本次改动涉及 shared 协议、session 服务、ui 组件和 hooks，并在 Host 组装时注入现有 Forge 服务。净增加 1537 行（增加 1652 行，删除 115 行，含 spec 与测试，不含截图）。

状态唯一所有者是 Host WorkTaskService / SQLite；UI 读取已有共享任务列表。事件顺序为：创建并保存来源 → 处理 → 审阅 → 用户验收或成功合并 → 保存同步意图 → 评论及收据 → 关闭并直接读取远端状态 → 保存收据。Desktop continuous 和手机 replayable 保留既有 task 通知与列表投影。

- pnpm typecheck：通过。
- pnpm lint：0 错误，73 项现有警告。
- pnpm architecture:check --changed：通过，基线违规 0，新增违规 0。
- 修改文件格式检查与 git diff --check：通过。
- 相关测试：53 项通过，0 失败，0 跳过。
- repositoryPanel 浏览器场景：通过，覆盖持久状态、重新处理、来源范围、详情评论刷新、搜索索引延迟及手机/桌面主题。
- forge-completion 浏览器场景：通过，覆盖 API/ACP 完成及合并选项、取消、部分失败后重试、重新挂载、评论去重和窄屏布局。
- 原有 completion 与 branches-merge 浏览器场景：通过。

服务测试使用真实临时 SQLite 和模拟 Forge；浏览器使用模拟 Host/Forge，未执行真实远端评论、关闭或模型调用。旧任务未保存来源的仍保持未关联，不从提示词自动推断。代码未提交、推送或合并。
