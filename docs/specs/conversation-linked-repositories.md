# 单会话关联项目（issue #82）：轻量版实现与后续隔离方案

状态：已在当前工作树实现轻量版。当前产品规则和验证见末尾；前序调查与完整隔离提案保留为后续方向，不作为本次交付承诺。

来源：https://github.com/caiqiqqq/zcode-private/issues/82 。2026-10-12 通过 GitHub CLI 核实：issue 为 OPEN，标题及正文与用户提供的引用一致，无评论。源码基线为 `b1159fa0`；当时为只读调查，当前实施范围见末尾轻量版本规则。

## 实施前的已确认事实与证据边界

1. 当前工作树草稿流程只把一个 `workspaceAbsPath` 传给 `gitService.createAutomaticWorktree`，成功后打开这个工作树的新草稿，不传其他仓库。入口：`packages/ui/src/app-shell/WorkspaceShellLayout.tsx:1274`。
2. `GitCreateAutomaticWorktreeRequest` 只包含当前仓库定位信息及工作树根目录。`GitCliRepo.createAutomaticWorktree` 解析一个仓库、生成一个分支和目录、调用一次 `createWorktree`。入口：`packages/shared/src/git.ts:207`、`packages/services/src/git/repo/gitCliRepo.ts:1425`。
3. 原生 CLI 的 `resolveWorkspacePath` 对绝对路径直接 normalize 后返回；源码明确允许 workspaceRoot 之外的路径，没有关联仓库到工作树的映射。Write / Edit 都调用这个函数。入口：`apps/zcode-cli/packages/core/src/tool/path-policy.ts:15`、`tool/handlers/write.ts:84`、`tool/handlers/edit.ts:117`（后两条相对于同一个 core/src 目录）。
4. Bash 在执行结束后校验返回的 cwd，必要时恢复主 workspace；这不能撤销命令已经在外部路径产生的文件修改。入口：`apps/zcode-cli/packages/core/src/tool/handlers/bash.ts:206`。
5. 当前 ACP 创建及恢复会话都只传一个 `cwd: input.workspacePath`；不能据此假定外部 ACP Agent 支持多仓库目录授权、路径重定向或统一的写入拦截。入口：`packages/services/src/acp/acpStdioConnection.ts:332`、`:346`。

结论：可以确认当前缺少跨仓库工作树绑定，且原生路径解析层保留后端原目录。无法确认用户当时实际使用的 Agent、权限模式、后端分支及具体写入工具；“后端一定在 main 修改”不是通用规则，实际修改落在该目录当前检出的分支。

### 本次最小复现

使用 Node 24.14.0，在临时目录创建两个独立 Git 仓库 `frontend` / `backend`，均初始化为 main；仅给 frontend 创建工作树。

读取当前 `path-policy.ts`，用 Node 的 `stripTypeScriptTypes` 加载其函数。因当前 checkout 没有 node_modules，仅把未进入的错误构造依赖替换为抛错 stub；正常路径分支保持源码原样。调用参数：

```text
inputPath       = <临时目录>/backend/app.txt
workingDirectory = <临时目录>/worktrees/a082/frontend
workspaceRoot    = <临时目录>/worktrees/a082/frontend
operation        = write
```

断言解析结果仍等于后端原目录，然后通过临时文件系统写入该结果。Git 实测：backend 分支为 `main`，状态为 `M app.txt`，backend 工作树数为 1。临时目录已清理。

这是源码路径解析加临时文件系统/Git 的复现，未经过完整 Write handler、权限适配器、模型或 UI；不能作为桌面/手机、原生 Agent/ACP 全链路复现或修复验证。

## 建议产品规则

用户先明确选择本次会话参与的仓库及用途（修改 / 只读参考），再为需要修改的独立仓库准备工作树。自然语言提到另一个项目、导入路径或附近目录不自动授予写权限，也不自动改其 Git 状态。

- 现有前端工作树可经 Git 校验后作为主执行目录复用；后端从用户所选源仓库/分支固定一个基准 commit，再创建独立工作树，不 checkout 后端原目录。
- 每个仓库保存自己的分支、基准 commit 和真实执行路径。可以展示同一个关联组名称，但分支不要求同名，提交也不具有跨仓库原子性。
- 相同 Git 仓库内的多个目录共用一棵工作树，并保存目录相对仓库根的偏移。独立嵌套仓库需要单独识别；子模块第一版应明确拒绝，不能当普通子目录处理。
- 只读参考仓库可以使用源目录，必须标明用途并由可验证的执行边界限制写入。若适配器不能落实只读限制，不宣称提供隔离保证。
- 原仓库未提交内容不自动复制到新工作树；创建前展示固定基准及这一行为，保留原目录的改动。无 HEAD、非 Git 或不支持的仓库类型返回明确错误。
- 绑定完成后向模型提供每个仓库的名称、角色、基准与执行目录；文件、Git、测试和构建操作均定位到所选仓库执行目录。Prompt 是引导信息，不能承担唯一隔离约束。
- 用户输入原目录绝对路径时，不暗中改写自由文本或 Shell 命令。结构化文件操作可返回明确的目录映射提示；写入原目录必须被可靠边界拒绝，使用已绑定执行路径重发。
- 会话运行时不切换绑定。静止时新增仓库也先完成准备和持久化，恢复必须复用已验证绑定，不能创建另一棵工作树或悄悄回退原目录。
- 完成或归档只更新会话状态，不自动合并、提交、推送或删除任一工作树。各仓库的 Diff、提交和合并目标分别展示及执行。

## 唯一所有者、接口与事件顺序提案

会话关联仓库绑定由 Services 层的会话应用服务持有，通过仓库持久化；Git 服务继续是工作树创建、验证和删除的唯一执行入口。Main 和外部 relay 不持有新业务状态；Renderer 只保留选择草稿和操作中的投影。CLI/runtime 和 ACP adapter 消费不可变的绑定版本，不另建可写的关联清单。

建议新增严格类型及运行时校验的命令/查询契约，名字为提案，不代表已有 API：

| 操作 | 必要语义 |
| --- | --- |
| prepareConversationRepositories | 提交 requestId、会话目标、预期绑定版本、明确选择的仓库及角色；服务校验静止状态并固定 Git 基准 |
| getConversationRepositories | 返回准备状态、版本及每个仓库的源定位、执行定位、分支、基准 commit、目录偏移、角色和错误 |
| execution binding | 会话创建/恢复及每次工具执行使用同一个已持久化版本；未 ready 时不接受涉及新绑定的模型输入 |

每个定位保留 `workspaceIdentity`、`workspacePath`，远程还贯穿 `remoteSessionId`；身份 key 为 `workspaceIdentity?.trim() || workspacePath`。Git 去重另外使用同 authority 下解析的仓库 common-dir / 根目录关系，不能用仓库 basename 或字符串前缀比较。

```text
用户选择仓库 -> UI 草稿 -> 会话服务 admission（静止、版本、requestId）
                              -> 持久化 preparing + 固定每仓库基准
                              -> Git service 分别分配工作树
                              -> 逐项持久化分配结果并验证归属
                              -> 持久化 ready 绑定版本
                              -> 既有 API / ACP 会话命令与 CommandInbox
                              -> runtime/adapter 使用绑定执行

desktop continuous -> 既有实时投影 ---------+
                                          +-> 同一服务状态与绑定版本
mobile replayable -> 既有快照与断档恢复 ----+
```

幂等键以会话 scope + requestId 关联，重复命令只读取原操作。恢复时校验路径、Git 注册、分支、基准和绑定归属；拒绝 stale version、失效 owner/lease 和不一致结果，迟到响应不能更新另一会话。

多个仓库无法依赖一次 Git 操作保证原子性：部分成功时保留分配记录、标记失败并阻止首发；重试只继续未完成项。不得自动删除包含改动的成功工作树，清理必须复用已有受控删除规则。

## 平台与执行边界

原生 API 模式需要把关联清单传入 CLI/runtime 的结构化契约，文件工具、Git 定位、上下文和命令执行使用相同绑定。仅修改 path-policy 或 cwd 无法约束 `bash` 中的绝对路径、脚本及子进程写入；实施前必须明确能落实的文件系统/进程执行策略。

ACP 标准会话入口在当前代码中只有单 cwd。对每个已安装 Agent 逐项核实多目录配置、读写授权和恢复能力；未核实前不能承诺统一支持。若无法保证单会话隔离，应明确显示能力不足并阻止选择该模式。分开会话是另一个产品方案，不能作为本需求已经实现的证明。

第一阶段建议只支持同一执行 authority 上的本地 Git 仓库；手机连接现有桌面 Host，提交同样命令并读同样绑定，不新建 Agent 或 Host。同路径不同远端身份不得串绑定。跨 SSH/WSL authority 的单会话执行先明确拒绝，后续通过现有身份与连接接口扩展。

待产品对齐的关键决策：关联仓库入口及会话生命周期、仅支持具有可靠隔离能力的执行器还是允许明确标示限制的模式、只读参考的权限落实方式、源目录未提交内容的提示，以及跨仓库审阅入口。当前证据不足以直接承诺所有 ACP Agent 或任意 Shell 命令的隔离。

## 实施顺序与现有入口

1. 对齐以上产品规则并建立最小失败用例；安装当前 package.json 锁定依赖后，先运行架构检查及目标模块受控上下文。
2. 在 shared 定义关联仓库契约及严格 schema；在 services 明确会话 owner、持久化、幂等准备与恢复，复用 git 服务。新协议入口以当前仓库实际协议版本为准。
3. 在原生 CLI 增加绑定读取、目录上下文和可验证的执行边界；核实 ACP 能力后增加明确适配，拒绝能力不足的模式。
4. UI 经现有 hooks/service 入口选择仓库与查看执行目录，遵守 DESIGN.md、国际化及深浅主题；复用既有 Diff/Git 组件，但每次查询明确指向仓库执行目录。
5. 再接入桌面实时投影与手机恢复投影，验证恢复、失败和操作幂等；不引入新的 accepted 输入队列。

现有回归入口为 `packages/services/test/gitWorktree.test.ts`、`gitManagedWorktrees.test.ts`、`workTaskWorktreeExecution.test.ts`（后两条相对于 services/test）；包内没有统一 test script。实现时应新增专门的会话关联仓库测试，而非把工作任务 worktree 类型当作现有普通会话的多仓库能力。

feature graph 当前 `boundary.work-task-worktree` 描述单仓库工作任务分配，可以作为复用入口；没有已验证的单会话关联仓库节点。记录为 graph-drift-candidate，待新接口落地后添加经过源码核验的节点，不把提案登记为现有能力。

## 完整隔离方案的验收场景（后续方向）

| 设置与动作 | 必须断言的结果 / 证据 |
| --- | --- |
| 前端已有工作树，登记后端并首次发送 | 前端复用、后端分配工作树；两端修改只出现在各自执行路径；两个原目录 Git 状态和分支不变 |
| 源目录有未提交内容，从指定 commit 创建 | 原内容保留且不复制；实际执行基准与持久记录一致 |
| 修改后端时模型使用旧绝对路径 | 明确拒绝原目录写入并指出绑定路径；原目录文件哈希不变 |
| Shell/脚本/子进程写后端源目录，或通过 symlink 越界 | 可靠执行边界拒绝；无法限制时能力检查必须拒绝隔离模式；不能只校验命令结束 cwd |
| 同仓库两个子目录、两个同名独立仓库 | 前者共享正确工作树及目录偏移，后者分别绑定，绝不按名称合并 |
| 部分创建失败、重复点击、崩溃后恢复 | 不首发、不回退原目录；原分配记录保留；retry 不重复创建成功项 |
| 工作树丢失、Git 注册或分支被外部改动 | 会话恢复明确失败，不自动重新创建或切换原目录 |
| 当前会话 running，或 UI 切会话后旧准备返回 | 不修改运行中的绑定；迟到结果不覆盖新会话或发送旧草稿 |
| 原生 Agent 与每个宣称支持的 ACP Agent | 实测修改、Shell 越界、恢复均符合其声明；只返回 session/new 成功不算隔离验收 |
| 手机重连、同路径不同 identity、跨 authority | 正确恢复既有绑定且不另起运行时；身份互不串用，不支持的 authority 明确拒绝 |
| 完成、归档、审阅和手动 Git 操作 | 零自动提交/合并/推送/删除；逐仓库展示真实 Diff、分支和执行路径 |
| 桌面/窄屏 Web、深浅主题、中英文 | 仓库角色及完整路径可辨认，无横向溢出；交互 E2E 走真实会话入口 |

## 前序只读调查的验证结果（安装依赖前）

- freshness 脚本通过其现有阈值检查：相对本地 origin/main ahead 226 / behind 1，无远端跟踪分支；本次没有 fetch，不能当作实时远端同步证明。
- 最小路径解析/Git 复现通过，范围如上，不等同于完整 Agent/E2E 验证。
- 使用 Node 24.14.0 执行 `pnpm typecheck`，退出码 2；出现缺少 workspace 依赖及类型声明等大量错误。当前没有 node_modules，不能据此认定全部错误只由环境造成。
- `pnpm lint` 退出码 1，`oxlint: command not found`。
- `pnpm architecture:check --changed` 与 `pnpm architecture:context services` 均退出码 1，缺少 `typescript` 包，未生成受控上下文，也没有架构通过结论。
- 本次仅新增提案文档；实现、单测及交互 E2E 尚未完成，issue 未关闭。

## 2026-10-12 轻量版本实施规则

用户已确认先实现上文讨论的“关联项目”界面和实际操作。第一版不引入跨仓库 Shell 沙箱、共同父目录迁移、统一提交或新的 accepted 队列。

- 在普通 API / ACP Composer 输入框上方提供“关联项目”；本地主项目始终保留，关联项目可以从当前打开的本地目录选择或通过平台目录选择器 / 明确绝对路径添加。远程 workspace 暂不提供该功能，不能把远程路径传给本机服务。
- 面板显示主项目、关联项目源目录、基准分支、工作树选项及真实执行目录。默认新建工作树；用户显式取消时使用所选目录并明确提示。选择已有工作树时可直接复用。
- 选择、分支查询和点击完成只更新 Composer 配置，不执行 Git 写入。首次发送在原有发送互斥内逐项准备工作树，成功项即时记录；某项失败阻止 prompt，保留正文和成功项，重试复用。每次发送重新校验已有工作树与源仓库/分支关系，目录缺失或关系改变时报错，不回退源目录。
- 工作树基于所选本地分支解析出的固定 commit 创建，不复制未提交改动。扩展既有自动创建接口的可选 startPoint，不新建另一套工作树分配器。
- 唯一配置 owner 是现有 useDraftConfigControl / V4ComposerDraft：新增关联项目字段随 native draft promotion、ACP draft inheritance 和工作树草稿转移保存，发送清正文不清关联。新建无关对话不继承旧绑定。此字段是客户端明确发送意图，不是 Host 业务队列或 Git 状态事实；Git 服务仍是工作树事实的来源。
- Slash 命令沿用原有命令语义，不创建关联工作树或追加目录尾块；下一条普通文本发送再准备项目。
- 模型目录引导复用现有正文上下文序列化：每次普通文本首发/续发附带严格可解析的关联目录尾块，原生历史行隐藏尾块。API / ACP 均使用同一构造函数；模型看到源目录与执行目录，并收到使用执行目录及分别操作 Git 的指引。它是提示引导，不提供强制隔离保证。
- 当前设备刷新后复用会话配置。手机/其他设备尚不同步该客户端配置，不承诺跨设备恢复；既有 continuous / replayable、Host owner/lease 和 admission 不变。
- 面板与准备请求绑定 workspace identity/path + composer scope；切换、卸载、修改正文后的旧响应不得发送或修改新 scope。已完成的 Git 分配即使 UI 切换也保存到原 scope，不能丢失后再重复创建。运行期间禁止变更项目选择。
- 本次复用现有按真实 workspace 的 Git/Diff 页面；面板展示可选择的执行路径，不实现新的统一 Diff 或自动 Git 交付。

```text
关联项目面板草稿 -> 现有 Composer draft owner（本机持久化）
首次发送 -> 现有发送互斥 -> Git 查询/解析基准/逐项工作树创建
         -> 原 scope 即时保存成功结果 -> API/ACP 原有 prompt admission
续发 -> Git 验证执行目录 -> 相同目录引导 -> 原有 prompt admission
```

实施验收：真实临时 Git 前后端仓库验证指定分支基准、原分支与未提交改动不变、失败后复用成功项、已有工作树复用及错误归属拒绝；Composer 配置验证会话 scope/身份隔离、promotion、刷新恢复；UI E2E 验证添加/移除/分支选择/工作树选项/错误与重试、宽窄屏及深浅主题；API/ACP prompt 使用同一尾块但未执行模型请求时不声称完整 Agent 验收。


## 轻量版验证与实现边界

- shared：`linked-repositories.ts` 提供严格配置 schema；Git 自动分配沿既有服务接口增加可选 `startPoint`，旧调用方保持从 HEAD 创建。
- services：Git Repo 是唯一 Git 写入入口；通过已解析的 commit 固定基准，不切换或复制源目录。
- UI：`useLinkedRepositories` 协调准备；活跃配置由 `useDraftConfigControl` 单一入口写入，离开的原 scope 通过既有 Composer storage helper 记录成功分配。`LinkedRepositoriesControl` 只承载面板交互。API、ACP 和新主工作树草稿转移共用准备函数。
- 配置按 workspace identity/path + composer scope 保存；刷新、native promotion 和 ACP provisional draft inheritance 已验证。目录引导在原生和 ACP 历史展示中隐藏。
- `pnpm exec tsx --test packages/ui/test/linkedRepositories.test.ts packages/ui/test/worktreeDraftIntent.test.ts packages/ui/test/acpPromptDraft.test.ts`：10/10 通过。包含真实临时 Git 仓库测试，未调用模型。
- `linkedRepositories.e2e.mjs`：真实 Composer / Lexical / hook / 面板，模拟 Git 和 Agent admission；1280/375 宽度、深浅主题 4 组均通过。覆盖无效路径、Git 查询失败、添加、选分支、准备失败保留正文、重试、续发复用、外部分支改变拒绝、刷新、切会话迟到完成、ACP 及直接目录模式；弹窗边距与页面无横向溢出有断言。
- `linkedRepositoryDraft.e2e.mjs`：实际 Composer owner 的 native promotion、ACP inheritance、scope / identity 隔离、刷新恢复、API / ACP 历史隐藏全部通过。
- `composerSubmissionScope.e2e.mjs`：桌面 continuous 和窄屏 replayable 原有提交 scope 回归 4 组通过。
- `pnpm lint`：退出码 0，74 warnings / 0 errors；保留现有告警。`pnpm architecture:check --changed`：baseline 0 / current 0 / new 0。`git diff --check` 通过。
- 首次完整类型检查失败来自未构建的 `@zcode/dynamic-workflow` / `@zcode/dynamic-workflow-runtime` 声明产物；源码在 workspace 内，按包脚本构建这两个依赖后，`pnpm typecheck` 完整重跑通过（退出码 0）。
- 交互预览在 `/tmp/zcode-linked-projects-preview`，复用实际 Composer/面板源码和桌面 Vite 配置，服务使用演示数据，不创建真实仓库、不发模型请求；截图由 Playwright 实际渲染并检查。预览入口 `http://127.0.0.1:5175/`。
- 第一版仅本地目录提示引导，不提供任意 Shell/ACP 写入拦截，不同步跨设备配置，不提供统一 Git 交付或原子多仓库提交；未声称真实模型执行与打包安装验收。没有提交、推送、合并或关闭 issue。


## 2026-10-13 同步主分支的兼容规则

- 自动工作树保留主分支的 `sourceBranchName` 解析入口，并兼容关联项目已冻结的 `startPoint`；明确来源分支时优先解析来源，不退回 HEAD。
- ACP 行投影已由主分支迁移到 shared，保留唯一共享投影。将关联项目尾块的纯构造/解析函数一同放到 shared，UI 经原有入口复用；共享投影展示 user row 时隐藏尾块，保持增量快照与历史一致。
- 同步后重跑类型检查、Lint、架构、指定基准/来源分支 Git 测试，以及关联项目与 Composer 提交 scope 的交互回归。


同步主分支后的验证：`pnpm typecheck` 通过；`pnpm verify:pre-push` 通过（Lint 74 warnings / 0 errors，架构 baseline/current/new 均 0）；格式检查及 diff check 通过。指定的关联项目/草稿/来源分支/服务投影测试 17/17 通过，UI ACP 投影测试使用 `--tsconfig packages/ui/tsconfig.json` 后 5/5 通过（首次根配置运行无法解析 UI 路径别名）。关联项目 UI 深浅主题/桌面窄屏 4 组通过，Draft owner 回归通过，Composer submission scope 4 组通过（首次并行冷启动页面加载超时，独立重跑通过）。验证使用临时 Git 与模拟 Agent admission，未进行真实模型写入或安装包验证。
