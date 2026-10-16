# CodeVori 产品名称

## 产品规则

- 本分支应用的用户可见名称为 `CodeVori`，各语言均使用此拼写。
- 正式版为 `CodeVori`，预览版为 `CodeVori Preview`，开发版为 `CodeVori Dev`。
- macOS 的 CodeVori 与旧 ZCode 使用不同 bundle ID，允许同时安装；系统录屏授权后的“退出并重新打开”必须仍打开 CodeVori，不能由 LaunchServices 解析到旧 ZCode。
- 桌面菜单、Dock/托盘、关于窗口、窗口标题、Web 页面标题、欢迎/设置/输入框文案、安装包文件名和系统“在应用中打开”菜单使用新名称。
- 产品图标使用 CodeVori 的 `V` 字母：白色几何字形配黑色圆角底，沿用现有紧凑比例。应用、Dock/托盘、安装器、启动页、关于页、导航标志与网页 favicon 使用同一字形；首页装饰使用同一字形的浅色线框/深色渐变版本。
- 手机壳的 Expo 配置、连接页及权限说明同样消费共享产品名称；手机图标从共享 V 字形生成不透明的正方形资源，由手机系统裁圆角。保留既有手机安装身份和连接存储，详细规则见 `mobile-app.md`。
- 供应商、API 模型和 ACP 智能体的第三方图标不跟随产品改名；保留原作者和许可证。

## 所有者与接口

- `packages/shared/src/product-brand.mjs` 唯一维护产品显示名，通过 `@zcode/shared` 与构建脚本专用的 `@zcode/shared/product-brand` 公开入口提供。
- `desktop-product-identity.mjs` 维护 production/preview/development 的桌面身份映射，并通过纯函数解析显示名与存储目录名。Main 在启动时应用结果，不引入新的设置字段、缓存或持久化写入路径。
- 正式/预览身份映射分别拥有 `macAppId`：`dev.codevori.app` / `dev.codevori.app.preview`。electron-builder 按目标平台消费它，不能按构建宿主平台选择；开发副本由既有 `devElectronAppBundle.mjs` 使用 `dev.codevori.app.development`。Windows/Linux 继续消费原 `appId`。
- 各平台的已有标题、菜单、国际化和打包入口消费显示名；Host、会话服务与数据仓库继续使用原来的身份和路径。
- ACP initialize 的 clientInfo 与 Codex API 接入配置的供应商显示名使用新名称，协议字段、供应商 key 与版本保持原值。
- 共享 `product-brand.mjs` 同时拥有产品字形及 viewBox。UI 与 Main 关于页通过公开入口读该字形；异步图标生成脚本从同一源导出桌面 PNG/ICO/ICNS、Linux 各尺寸、UI 图标及 Web favicon，并同步 HTML 启动标志。派生资源保留已有路径以兼容现有打包和平台命令。
- macOS 开发副本安装自己的产品 ICNS，Info.plist 明确指定它。开发 bundle 缓存命中后仍检查图标内容并幂等同步，不修改 node_modules 原始 Electron，不因图标变化重拷整套运行时，不改变 bundleId、URL scheme 或用户数据目录。

```mermaid
flowchart LR
  brand[共享产品名称] --> build[桌面产品身份]
  brand --> messages[中英文文案与 Web 标题]
  build --> main[Main 启动解析]
  main --> display[setName / Dock / 菜单 / 关于窗口]
  main --> storage[setPath 使用兼容目录名]
  storage --> existing[原配置 / Cookie / 会话数据]
```

## 兼容与失败边界

- Electron userData 默认目录仍为 `ZCode`、`ZCode Preview`、`ZCode Dev`，sessionData 仍位于对应目录的 `session`；应用显示名改变不能创建一套空配置。
- `ZCODE_DESKTOP_APPLICATION_NAME` 继续同时覆盖测试显示名和默认 userData 目录名；显式 userData/sessionData 环境变量及 Electron 默认目录测试开关保留原语义。
- Windows AppUserModelId、Linux 安装身份/命令、URL scheme、Windows 注册表键、Finder workflow 文件路径、原生电脑控制 Helper 身份保持兼容。仅更新这些入口的展示文案，不重复注册一个并行入口。
- macOS 主应用 bundle ID 使用独立身份：旧 ZCode 与 CodeVori 共用 ID 会导致系统授权重启打开旧应用。旧 TCC 授权不迁移、不删除，用户需为新身份重新授权；userData/sessionData 仍使用原目录。仅改变应用内 `app.relaunch()` 无法修复系统设置发起的重启。
- `.zcode` 数据、项目目录、Worktrees 设置、包名、协议方法、配置键、环境变量、模型/智能体 ID、账号端点和已有第三方链接不做全局替换。
- 保留原作者和许可证信息。没有新官网或新发布源时，不虚构域名或更改升级来源。
- 名称解析是无 IO 的启动前决策；缺失 flavor 仍沿用现有 production/preview 规则。目录不存在时继续由既有存储启动链创建，不迁移、不删除旧目录。

## 验收场景

1. 正式/预览/开发身份分别显示新名称，同时仍返回各自旧 userData 目录名及原 appId。
2. 生产后端 + Preview 身份仍为 Preview；测试后端不能解析为正式身份。
3. 显式应用名覆盖仍隔离测试数据；输入为空白时仍使用默认身份。
4. macOS Dev bundle 的 CFBundleName/CFBundleDisplayName 为 CodeVori Dev，bundleId 为 dev.codevori.app.development，zcode scheme 保留，启动路径为 CodeVori Dev.app；旧身份缓存不能直接复用。
5. 中英文关于/托盘菜单、欢迎语和新对话输入框均出现 CodeVori；实际 `.zcode/v2` 路径提示与协议键不变。
6. 正式/预览安装包名称由新的 productName 生成；Windows/Linux 配置及 macOS 权限提示使用相同名称。
7. 页面验证覆盖中文和英文、宽屏和手机宽度、深浅主题；标题和品牌文案没有截断或横向溢出。
8. 重启本地桌面开发版后，系统应用名、窗口名及菜单可见新名称，主进程读取的 userData/sessionData 与重启前一致。
9. 应用和安装图标在 16px 至 1024px 均显示 V，macOS ICNS 和 Windows ICO 包含所需尺寸；网页 favicon 和导航/启动/关于/草稿装饰与它一致。深浅主题和手机宽度下无破图，不改供应商/智能体品牌。
10. 首次生成开发 bundle、运行时缓存命中与图标更新后均使用产品 ICNS；相同内容不重复写文件，图标同步失败明确报错。重启通过原 LaunchServices 路径，确认 Dock 已使用 V，历史配置仍使用原目录。
11. 正式/预览 macOS 打包配置使用独立 CodeVori ID；在 macOS 宿主上交叉构建 Windows/Linux 时仍返回原 appId。三个 macOS flavor 的 ID 互不相同且均不等于旧 ZCode ID。
12. 旧 ZCode 与新 CodeVori 同时安装后，为 CodeVori 开启录屏授权并选择系统“退出并重新打开”，恢复进程的 bundle ID、可执行路径和应用名均属于 CodeVori。自动化验收用隔离临时 bundle 验证 LaunchServices 身份解析，不操作真实 TCC 或正在运行的用户应用；真实授权重启单独记录，不能用隔离测试代替。

```mermaid
sequenceDiagram
  participant B as 构建身份所有者
  participant C as CodeVori app bundle
  participant S as 系统设置 / TCC
  participant L as LaunchServices
  B->>C: 写入独立 CodeVori bundle ID
  C->>S: 用户为该身份授权
  S->>C: 退出当前进程
  S->>L: 按 CodeVori 身份重新打开
  L->>C: 恢复 CodeVori（原配置目录）
```

## 验证

- 桌面产品身份和 Dev Info.plist 的 Node 测试；中英文菜单与目录兼容断言。
- 现有 Vite 上的品牌文案页面验证，以及本机 Electron 重启后的只读名称/数据目录核对。
- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 与改动文件格式检查。

## 历史改名验证记录

- 改动模块：shared、desktop、services、ui、web。产品名由共享常量唯一维护，Main 同步解析显示名和兼容目录后再启动窗口与 Host；没有新增业务状态、迁移队列或远程事件。
- 本次改名涉及 50 个代码、配置和测试文件，净新增 215 行（不含本 spec）；保留此前其他功能的本地改动。
- 桌面身份/启动与 ACP 配置/stdio 共 19 项测试通过。页面验证通过中文/英文、375/1280 宽度、深浅主题共 8 个场景，覆盖实际帮助菜单和输入框提交。
- 根目录 `pnpm typecheck` 通过；Lint 为 0 errors、72 warnings；架构检查 baseline/current/new 均为 0；桌面 production 构建成功。
- 额外 Desktop Main 子工程类型检查仍有既有失败；使用改名前源码快照进行无写入诊断比对，未发现本次新增问题，没有将该额外检查记为通过。
- 本机重启后应用和进程显示 `CodeVori Dev`，窗口标题为 `CodeVori`，Renderer 已挂载；主进程继续打开原 `ZCode Dev` userData 目录，未使用 `CodeVori Dev` 新数据目录。

## 历史 V 图标验证记录

- 改动模块为 shared、desktop、ui、web；共享字形是唯一源，其余图标均为派生产物，没有新增业务状态或协议。
- 图标更新与桌面品牌兼容共 7 项 Node 测试通过，覆盖首次安装、缓存命中、内容不变及图标更新；原 Electron 副本来源、bundleId 和 URL scheme 保持兼容。
- 实际组件页面验证通过中文/英文、375/1280 宽度、深浅主题共 8 个场景，检查 V 字形、图片解码、主题装饰互斥、无横向溢出及输入框提交。SVG 可由 Vite 内嵌，验证实际内容而非资源 URL。
- PNG、ICO、ICNS 实际解码通过；应用及网页 ICO 包含 16、24、32、48、64、128、256 尺寸，ICNS 可解码至 1024，透明四角保留。
- 根目录类型检查通过，Lint 为 0 errors、72 warnings；架构检查为 0 violations，16 个相关文本文件格式检查及 `git diff --check` 通过。
- 桌面 production 构建通过，并通过现有 LaunchServices 路径重启。本机运行副本的 `CFBundleIconFile` 指向 `codevori.icns`，图标内容与构建资源一致，窗口正常加载；主进程仍打开原 `ZCode Dev` userData/sessionData，没有新建 CodeVori 数据目录。

## 授权重启身份修复验证记录（2026-10-09）

- 本机只读证据：`/Applications/CodeVori.app` 与 `/Applications/ZCode.app` 的 `CFBundleIdentifier` 均为 `dev.zcode.app`，当前 CodeVori 的 LaunchServices 注册也使用该 ID。截图中的重开由系统设置发起，应用内重启命令不是其所有者。
- 改动模块为 desktop，产品身份映射及开发副本分别拥有正式/预览与开发 bundle ID；没有新增业务状态或 UI 写入路径。代码和测试共 7 个文件，净新增 214 行，另更新两份 spec。
- Node 24.14.0 下 15 项品牌、开发缓存和启动回归测试通过；包含两个 flavor × 三个目标平台的真实打包配置加载。旧开发身份缓存会重建，Windows/Linux 身份及 userData/sessionData 兼容断言通过。
- macOS 隔离 E2E 通过：在用户 Applications 下注册带随机命名空间的两个临时应用，首次启动并退出后，按 bundle ID 重开旧应用一次、新应用两次；运行主体的 ID、名称和 bundle 路径均符合预期。夹具等待启动标记和进程退出，不用固定延时判定成功；最终注销并删除测试副本。
- Lint 为 0 errors、72 warnings；架构检查 current/baseline/new 均为 0；改动文件格式检查及 `git diff --check` 通过。
- 根目录 `pnpm typecheck` 通过。首轮发现新工作树缺少 `@zcode/dynamic-workflow` / `@zcode/dynamic-workflow-runtime` 的声明产物，按其现有 build 入口补齐后重跑通过；未修改这些包的源码。
- 未重新打包安装用户应用，未操作真实 TCC；系统设置授权后的真实重启仍需在新包安装、为新身份重新授权后验收。隔离 E2E 仅证明 LaunchServices 的身份重开路径。
