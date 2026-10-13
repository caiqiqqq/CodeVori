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

## 合并后仍报错：React 上传处理器就绪时序

用户反馈已安装版本仍返回 `FORGE_UPLOAD_UNAVAILABLE`。只读核对安装包
包含上一轮的 ClipboardEvent 修复，进程启动时间晚于安装包修改时间。
在真实 GitHub 新议题页面只读检查 DOM：英文 `Add a description`，
正文为可见、启用的 `textarea[aria-label="Markdown value"]`，挂载后存在
React `onPaste`。因此不能把这次报错归因于中文标签或直接认定为 CodeMirror；
此前基于中文标签猜测的改动已撤回。

已确认另一个时序缺陷：Main 在 `did-finish-load` 执行脚本，脚本把可见的
SSR textarea 当作上传已就绪，直接派发文件粘贴。页面 load 不保证 React
已水合，未挂载处理器时事件不被消费，立刻返回 upload unavailable。
之前的合成页面在脚本执行前同步注册监听器，没有覆盖这条路径。

当前 GitHub `react-core-38c3e823b8b765d2.js` 的 `LUx` 根节点实现，在
React `useEffect` 的 onCommit 完成后，经 requestAnimationFrame 和
requestIdleCallback 给 `react-app`/`react-partial` 添加 `loaded` class。
这提供了实际挂载完成信号，无需固定等待秒数或带文件探测后重试。
实现只在正文所属 React root 就绪后重新校验账号、解析当前编辑器并一次派发；
旧版非 React 编辑器保留原行为，原超时/取消/禁止网页创建边界不变。

```text
Main did-finish-load → 脚本观察 SSR DOM（不派发文件）
  → GitHub React commit effects → root.loaded
  → 校验账号与当前正文 → 一次 paste → 网页上传 → 新 URL → Host receipt
```

新增真实 React hydrateRoot/受控 textarea 测试：旧代码在 SSR 阶段提前派发
一次文件事件，两项新测试都失败；修复后 7 项浏览器测试通过。Electron
合成 HTTPS 用例将监听器挂载延迟到 load 之后，验证同一原生窗口等待 loaded
再上传成功。还覆盖始终未就绪、超时后迟到就绪、等待中账号变化、
就绪但无处理器和只派发一次。

这是已复现的代码缺陷，尚未取得用户报错那次原生窗口的完整运行时记录，
不能断言它是唯一原因，也不能把合成上传当成真实 GitHub 上传成功。
官方公开 REST/OpenAPI、GraphQL schema 和 Octokit 当前生成方法中均无
议题图片附件上传接口；仓库 Contents 和 Release asset 上传属于其他行为。
官方接口定义参考：
<https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json>、
<https://docs.github.com/public/fpt/schema.docs.graphql>、
<https://github.com/octokit/plugin-rest-endpoint-methods.js/blob/main/src/generated/method-types.ts>。

本轮本地验证：7/7 浏览器测试、原生 Electron 合成测试、桌面/手机双主题
图片 E2E 均通过；`pnpm typecheck` 通过，上传脚本独立 strict 类型检查通过；
`pnpm lint` 为 0 errors / 74 warnings；架构检查 0 violations，改动格式检查通过。

## 后续 macOS 原生崩溃：自动补全弹窗

用户提供的 macOS ARM64 崩溃报告为 Main 线程 `EXC_BAD_ACCESS / SIGSEGV`，
访问地址 `0xe0`。已安装构建的 `buildCommitId` 为 `f14fdab5`，包含上一轮
React 水合修复；运行时仍是 Electron 41.0.3。

使用 Electron 41.0.3 官方 darwin-arm64 symbols，模块 UUID 与报告完全匹配：
`4C4C4456-5555-3144-A1D7-2F9FC95F5CF0`。报告中的近邻 V8/Node 导出符号
不能作为真实函数名；按模块相对地址解析得到：

| 模块相对地址 | 真实调用点                                                         |
| ------------ | ------------------------------------------------------------------ |
| `0x4ddc`     | `base::internal::WeakReference::IsValid()`                         |
| `0x2beb3e0`  | `electron::AutofillPopupView::Show()`，`autofill_popup_view.cc:71` |
| `0x2b20d34`  | `electron::AutofillPopup::CreateView()`，`autofill_popup.cc:200`   |
| `0x2aca760`  | `electron::AutofillDriver::ShowAutofillPopup()`                    |

41.0.3 的 `Show()` 在检查父 widget 是否关闭前就调用
`parent_widget_->IsVisible()`。上游 [PR #51321](https://github.com/electron/electron/pull/51321)
补上关闭 widget、缺失 native view、失效 popup view 的生命周期检查，
与报告的原生调用路径对应。该证据确认崩溃位于自动补全弹窗；现有应用日志
不足以确认当时哪个窗口关闭操作触发了它，也不支持把它归因于图片解码。

修复采用同一大版本的 Electron 41.10.7，包含上述原生修复及空建议列表
修复 #52320，同步锁文件。检查发现 electron-builder 原先另外写死 41.0.3，
新增回归先验证其与新版依赖不一致，再改为读取已安装的 Electron 版本，
避免开发验证通过而发行包仍使用旧运行时。应用上传协议、账号隔离、Host receipt、一次派发
和无自动重试规则保持既有实现，不通过任意延迟或改写用户输入避开弹窗。

新增隔离 profile 的真实 Electron 回归，使用本地 HTML 和上游同样的
Tab/字符/Down/Enter 操作验证建议选择，再执行 24 次输入期间的子窗口销毁
和父窗口关闭。41.10.7 上通过；这不是旧运行时崩溃的确定性重现，也不是
真实 GitHub 附件上传成功的证明。升级源码不会改变已安装应用中的运行时，
需要新打包版本才能让用户端获得修复。

本轮验证：41.10.7 上原生自动补全选择/24 次关闭、GitHub 合成上传/登录恢复/
水合等待/取消、GitLab 原生媒体/登录/取消测试均通过；7/7 浏览器上传测试通过。
`pnpm typecheck` 通过；`pnpm lint` 为 0 errors / 74 warnings；
`pnpm architecture:check --changed` 为 0 violations；改动文件格式检查通过。
发行版本一致性、品牌/开发图标测试通过，41.10.7 原生 PTY 命令执行 smoke
通过。额外运行现有 computer-use 打包测试时，原生签名配置两项通过，
staged plugin 检查因本地缺少 bundled-agents 中的 `dist/mcp/server.js`
构建产物失败；不能据此宣称完整发行包已验证，本轮未制作或安装新发行包。
