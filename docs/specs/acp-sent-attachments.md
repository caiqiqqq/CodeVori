# ACP 已发送附件与共享消息样式

## 产品规则与迁移

- ACP 图片使用 API 的 `UserInputAttachmentList`：80px 缩略图位于文字气泡上方、右对齐，点击打开现有图片画廊。普通文件使用同一附件标签，PDF 复用已有预览。图片名称不再拼进新消息的正文。API 的上传、存储、读取和界面保持原语义。
- ACP Host 是已接受消息和附件的唯一所有者。在 admission 前，校验能力和大小，并将附件保存为会话专属、不可变的内容副本。图片副本必须与提交给 Agent 的 image block 字节一致；路径附件不能只保存原路径。每个附件最多 20 MiB，沿用 ACP 的 8 附件与 40 MiB inline 总量限制。
- 快照新增可选的 `attachments` 引用列表，复用共享 `AttachmentRef` 形状，仅包含不透明引用、原名称、MIME 和字节数，内容不进入 JSON、通知和诊断。`attachmentNames` 保留旧客户端兼容：前 N 项对应 N 个附件引用，其余项是工作区文件提及。只保存名称的旧会话继续展示名称，不猜测同名路径、不虚构图片。无附件会话无需迁移。
- 能力或保存校验失败时，不接受输入、不调用 Agent、不清理草稿；未提交副本清理。首次 admission 落盘失败恢复原快照；删除会话清理其附件副本。相同 commandId 重试不重复保存/执行。stop、remove 或 Host 换代期间的迟到保存不能发布新行；会话已接受后的 Agent 失败保留图片和正文。

## 边界与事件顺序

- `services/acp` 的现有 Host admission 状态机管理提交、revision、停止和删除；附件文件帮助类只执行异步 IO，不另建队列或会话事实。`shared/zcode-protocol/acp.ts` 定义元信息及严格有界读取契约，并由 `zcode-protocol/index.ts` 现有导出公开。
- 附件 IO 跟踪覆盖保存至未接受副本清理的完整生命周期。停止后开始的新轮不能覆盖旧轮的 IO 跟踪；删除会话与 Host 关闭等待全部在途附件操作，已删除会话不能发布迟到快照。
- 新增 `IAcpService.readAttachment`，先校验 workspace identity 与 path、会话、已接受 user entry 内的 ref，再读取会话专属副本。分块最大 128 KiB，返回 base64、MIME、总字节数和下一偏移；禁止通过任意路径、其他会话的 ref 或 symlink 读取。此查询不连接/认证 Agent。
- UI 从当前 Host 的 `acpService` 读取，使用当前 pane 的会话、workspace identity 和 attachment；接入现有 `ConversationRowRenderContext.readAttachment/readAttachmentRange`。取消、行卸载和会话切换停止后续读取，迟到结果由现有组件生命周期丢弃。不得把 ACP id 发给原生 CLI 附件接口。没有新增 Renderer 附件内容 store。
- 克隆快照中的同一附件不触发重新预取，生命周期按内容目标而非数组引用比较；切换等待及发送行为遵循 [ACP 交互等待](acp-interaction-latency.md)。

```text
冻结草稿 → 现有 Host ACP admission owner → 能力/文件校验 → 会话附件副本
                                                    → accepted user refs + 快照落盘/revision
desktop: continuous live revision ──────────────────┐
mobile: replayable snapshot + revision ──────────────┴→ 共享用户消息/附件组件
共享组件按需读取 → 当前 Host readAttachment → 校验 workspace/session/ref → 有界分块
共享组件 → 已加载图片 URL → 现有画廊；卸载/关闭 → 取消后续读取、释放 Blob URL
```

## 验收

- Host 集成：上传本地及 inline 图片、普通文件/PDF；Agent 收到原内容，快照仅含 refs。变更/删除源文件及重启 Host 后图片内容不变；同名不同图片正确分离；idempotent 重试不重复 admission/文件；删除会话清理副本。
- 失败与边界：不支持图片、超限、保存失败均不 admission；stop/remove 与保存并发不复活会话或留下副本。错 workspace identity/path、另一会话 ref、任意路径、symlink、非法偏移/大小被拒。读取不调用 Agent。
- UI E2E：通过真实 ACP `SessionPane`、消息组件与假 Host，图片在气泡上方显示并点击放大，普通文件标签不混入正文；连续同名图片分别正确显示。重开/切换会话、legacy 名称、失败读取、取消、桌面宽屏和手机布局均保持 API 样式；API 附件与上一轮时间轴回归通过。

## 本地验证记录（2026-10-08）

- Node 24.14.0；ACP Host、附件、prompt block、插件与工作流集成测试共 43 项通过；UI 行投影、附件读取、草稿转换与 admission 测试共 12 项通过。
- `packages/ui/test/acpTurnNavigator.e2e.mjs` 使用真实对话组件与假 Host，验证缩略图尺寸/位置、图片实际像素、画廊切图、历史重开、旧名称、读取失败、375px 布局，以及 API 附件与时间轴回归；未连接真实智能体。
- `pnpm typecheck` 通过；`pnpm lint` 0 errors、72 warnings；本次改动文件格式检查与 `git diff --check` 通过。
- 架构检查 current/baseline/new 均为 0。修改沿用 shared/services/ui 当前模块；ACP Host 仍为唯一 admission owner，先保存内容副本再发布已接受消息，IO 跟踪不承担会话状态。相关源代码相对当前 HEAD 净增 357 行，包含尚未提交的时间轴接入，不含测试/spec 和首版构建改动。
- 验证的是当前源码；本次未重新构建或替换已经安装的应用。仅存名称的旧消息无法恢复当时图片内容。
