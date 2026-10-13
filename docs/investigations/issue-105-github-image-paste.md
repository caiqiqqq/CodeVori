# Issue #105: GitHub 新议题图片上传窗口停在编辑器

2026-10-13 已通过 GitHub API 核实 `caiqiqqq/zcode-private#105`：OPEN，
标题和正文与任务引用一致。附件截图显示已登录的原生 GitHub 新议题窗口，
所以报告中的失败发生在图片已交给 native upload port 之后。

## 已确认的兼容性缺陷

`NewIssueDialog.onPaste` → `useForgeImageUploads` → Host `uploadForgeImage`
→ `executeGithubImageUpload` → `githubIssueUploadScript`。
旧脚本要求 `textarea[aria-label="Markdown value"]` 和全页恰好一个常驻
`input[type=file]` 同时存在，否则一直等待直到 `FORGE_UPLOAD_UNAVAILABLE`。

在未登录的公共 `microsoft/vscode/issues/1` 页面下载当前 GitHub 客户端资源，
只读取脚本，没有上传或创建议题：

- `jt-34bf3524fba30283.js`：CreateIssueForm 使用 Markdown editor，标签为
  `Add a description`，placeholder 为 `Type your description here…`。
- `tvt-5b92c78f8b5e1d83.js`：有 labelledBy 时 textarea 不使用固定
  `Markdown value` aria-label；上传处理复用 `kB.wd` 的 pasteTargetProps。
- `t52-267feeb4d201e64e.js` 的 `kB`：click handler 临时
  `document.createElement("input")`、设置 file 类型、注册 change 后调用 click，
  没有把 input 挂入文档。paste handler 直接消费 `clipboardData.files`，
  接受非空文件时 preventDefault。

因此“等待常驻 file input”不适用于当前 GitHub 编辑器，登录不能解决这个条件。
资源文件名是本次调查快照，不是实现硬编码的接口。

## 修复与验证边界

Native owner 先验证仓库 URL 和账号，再识别唯一可编辑的描述 textarea。
保留旧版关联的 file input；新版走网页自身 paste handler，只派发一次。
未消费 paste 则明确失败，超时为不确定结果；都不自动重试。
继续监听该 textarea 的新附件 URL，不修改 Host admission/receipt 或草稿 owner。

```text
UI draft → Host validate/admit → native identity check → unique editor ready
  → legacy file change / current editor paste (once)
  → webpage upload → newly completed URL → same Host receipt → same draft Markdown
```

新增合成浏览器回归在旧实现上返回 `FORGE_UPLOAD_UNAVAILABLE`，验证了这个缺陷。
覆盖无常驻 input、无关 input、身份与编辑器延迟、歧义/禁用/未消费事件、
超时清理、一次派发、既有模板 URL 和禁止网页创建。
Electron 合成 HTTPS 页面还覆盖新版 paste 与同窗口登录恢复。
现有 UI E2E 验证粘贴、选择、拖放、重试、创建门禁、Host 切换、桌面/手机和双主题。

这是源码与合成页面验证；尚未用真实 GitHub 账号上传附件，不能声称远端实测闭环。

本次结果：上传浏览器测试 5/5 通过，Electron 测试通过，图片 UI E2E 通过。
Node 24.14.0 下，补齐 dynamic-workflow 和 dynamic-workflow-runtime 的忽略构建产物后，
`pnpm typecheck` 通过；`pnpm lint` 为 0 errors / 74 既有 warnings；
`pnpm architecture:check --changed` 为 0 violations；改动源码与测试格式检查通过。
额外 Desktop Main 全量类型检查未通过：86 项诊断与 HEAD 完全一致，
上传脚本没有诊断。检查生成的无关源码旁产物已恢复/移除。
