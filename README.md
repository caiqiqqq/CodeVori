# CodeVori

<div align="center">
  <img src="packages/ui/src/assets/product-logo.svg" alt="CodeVori" width="128" height="128" />
</div>
<p align="center">
  <a href="https://github.com/caiqiqqq/CodeVori">项目仓库</a> ·
  <a href="https://github.com/caiqiqqq/CodeVori/issues">问题反馈</a> ·
  <a href="LICENSE">Apache-2.0</a>
</p>
<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>
CodeVori 是面向日常开发的 AI 编程工作台。你可以在同一个工作区中与智能体讨论需求、查看文件和代码差异、执行终端命令，并通过任务与 Git 工作树组织并行开发。除了桌面应用，还提供 Web 界面、终端 Agent 和连接桌面的手机端。

> **项目来源：CodeVori 基于 [ZCode](https://github.com/zai-org/ZCode) 二次开发，部分功能参考 [Codeg](https://github.com/xintaofei/codeg) 项目。**
>
> CodeVori 独立维护，不是 ZCode 或 Codeg 的官方发行版。感谢两个项目及其贡献者提供的开源基础与功能参考；原作者署名、许可证和第三方声明予以保留。

## 功能概览

| 能力            | 说明                                                                                    |
| --------------- | --------------------------------------------------------------------------------------- |
| AI 编程对话     | 在项目上下文中提问、修改代码、调用工具，并查看会话与执行过程。                          |
| 多智能体接入    | 通过 ACP 接入 Codex、Claude Code、Gemini 等智能体，在设置中管理适配器、认证和运行配置。 |
| 智能体协作      | 将子任务委派给其他智能体，在主会话中查看进度与结果。                                    |
| 待办与工作树    | 将开发事项保存为任务，结合独立分支和 Git worktree 管理执行、审阅与后续合并。            |
| 开发工作区      | 在对话旁查看文件、代码差异与终端，使用 Git 工具管理改动，并通过分屏同时处理多个会话。   |
| 远程开发        | 连接 SSH、WSL 工作区，由目标环境处理文件操作和智能体执行。                              |
| 手机远控        | 通过手机浏览器或手机 App 连接桌面窗口，查看项目和会话、发送消息及处理交互。             |
| MCP、技能与插件 | 按项目和智能体配置工具及技能，扩展任务可使用的能力。                                    |

智能体的可用能力取决于对应适配器、安装环境和账号配置；安装适配器后仍可能需要登录或配置模型服务。手机端复用电脑上已有的 Host 与会话，电脑需要保持运行且网络可达。

## 文档导航

- [手机端连接与开发](apps/mobile/README.md)
- [Agent CLI 与运行时](apps/zcode-cli/)
- [内置配置说明](config/README.md)
- [产品与功能规范](docs/specs/)
- [使用与数据说明](NOTICE.md)
- [第三方组件与版权声明](THIRD-PARTY-NOTICES.md)

## 开始使用

以下内容面向从源码运行和构建 CodeVori 的开发者。版本以根目录 [package.json](package.json) 为准，独立于上游 ZCode 的版本。

为兼容现有配置和工具链，命令 `zcode`、包作用域 `@zcode/*`、环境变量 `ZCODE_*` 以及 `.zcode` 数据目录仍保留原名；这不影响应用显示名称为 CodeVori。

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，工具版本以 [mise.toml](mise.toml) 为准。从本仓库克隆代码后进入根目录：

```bash
git clone https://github.com/caiqiqqq/CodeVori.git
cd CodeVori
pnpm bootstrap
```

后续命令均在仓库根目录执行。`pnpm bootstrap` 会安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

Agent CLI 与运行时源码位于 [apps/zcode-cli/](apps/zcode-cli/)，作为普通目录随本仓库一起克隆，无需单独拉取或初始化 Git submodule。

根据需要选择其他初始化或构建入口：

| 命令                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                          |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源，默认包含远程资源准备                            |
| `pnpm prepare:remote-assets`   | 单独准备远程运行资源                                              |
| `pnpm bootstrap:with-remote`   | 初始化依赖、本地与远程资源，并串行构建相关包；跳过桌面应用 bundle |
| `pnpm build`                   | 递归执行各 workspace 包的构建脚本，包括包内的资源准备步骤         |

默认 `bootstrap` 跳过远程资源准备，适合本地桌面开发。使用远程工作区或验证远程发行资源时，再运行对应准备命令。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

桌面端基于 Electron。`pnpm dev:desktop` 等同于 `pnpm dev:desktop:prod`，使用生产服务配置；启动时准备本地运行资源、构建桌面 Agent，再运行应用并监听源码变化。

需要独立开发数据目录时，可设置 `ZCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### 远程功能（SSH/WSL）

先执行 `pnpm bootstrap:with-remote` 准备远程资源（mock-cdn），再 `pnpm dev:desktop`；连接远程项目时资源选择「本地下载后上传」。开发态资源取自本地 `packages/desktop/mock-cdn` 和本地构建产物，经 SFTP 上传到远程，不访问 CDN。

### 手机连接桌面

手机端用于接手正在运行的桌面工作区，连接步骤如下：

1. 在 CodeVori 桌面端打开 **设置 → 局域网手机访问**，保存电脑的局域网地址或可解析到本机的域名及端口，然后开启访问。
2. 在可访问电脑的网络中，用手机浏览器打开完整连接链接；也可在手机 App 中粘贴链接，或扫描桌面提供的二维码后确认连接。
3. 连接到该桌面窗口后，查看项目、继续会话或处理智能体的交互请求。关闭目标窗口或退出桌面端会断开连接。

手机 App 源码位于 [apps/mobile](apps/mobile/)，使用 Expo 与 WebView，不在手机上另起 Agent。原生开发、构建签名和连接设置见 [手机端 README](apps/mobile/README.md)。连接链接包含访问凭据，请仅在可信设备与网络中使用。

### Web 开发

修改 Web 或后端源码时，使用开发模式：

```bash
pnpm dev:web

# 指定后端工作区（macOS / Linux）
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

该命令同时启动 Web 开发服务器（默认 `http://localhost:5173`）和后端（默认 `http://localhost:3030`）；浏览器访问前者。`/ws` 和一般 `/api` 请求代理到本地后端，`/api/v1/oauth/token` 单独代理到当前配置的产品服务。

Agent 源码修改后，执行 `pnpm --filter @zcode/cli... build` 并重启服务。需要验证完整发行包时，按下方“CodeVori 命令行版”打包章节解压运行。

### CodeVori 命令行版

命令行发行包包含 TUI、Web 和 Agent，统一使用 `zcode` 启动：无参数进入 TUI；第一个参数为 `--web` 时启动 Web；其他参数交给现有 Agent CLI 处理。两种模式都在本机运行，无需 Electron。

```bash
# 默认进入终端交互界面
zcode

# 启动 Web 界面
zcode --web

# 指定项目和端口，不自动打开浏览器
zcode --web --workspace /path/to/project --port 3030 --no-open

# 查看 CLI 或 Web 参数
zcode --help
zcode --web --help
```

Web 模式默认工作目录为当前目录，监听 `127.0.0.1`，默认不启用访问令牌，自动选择空闲端口并打开浏览器。访问终端输出的地址，按 `Ctrl+C` 停止服务。局域网访问可使用 `--host 0.0.0.0`；监听非本机地址时默认生成访问令牌，使用终端输出的带令牌链接。可通过 `--token` 指定令牌或 `--no-token` 关闭令牌认证。

直接启动通用 Web 服务的 HTTP 入口时，通过 `ZCODE_SERVER_AUTH_TOKEN` 配置 API／WebSocket 认证；通过程序接口创建服务时，使用 `authToken` 选项。

构建方式见下方打包章节。`pnpm build:zcode` 只生成发行包，不会替换 `PATH` 中已有的 `zcode`。如果命令仍指向旧安装或其他源码目录，macOS / Linux 可用 `command -v zcode` 检查，Windows 可用 `where.exe zcode` 检查。

### CLI 源码开发

直接开发 TUI 或 Agent 时，运行源码入口：

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# 构建 CLI 及其 workspace 依赖
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

这个入口直接运行 Agent CLI，不经过发行包的 `--web` 分流。开发 Web 用 `pnpm dev:web`；验证统一的 `zcode` 命令，用下方解压后的 `bin/zcode.mjs`。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                                 | 用途                                             |
| ------------------------------------ | ------------------------------------------------ |
| `ZCODE_DATA_BASE_DIR`                | 应用数据基目录，数据写入其下的 `.zcode/`         |
| `ZCODE_SERVER_WORKSPACE`             | Web 后端的工作区路径                             |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |
| `ZCODE_DIST_BASE_URL`                | 命令行安装脚本使用的下载根地址                   |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

## 打包

构建与分发时需保留相应第三方声明；组件与许可清单见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，原始材料位于 [third-party](third-party/)。

### 桌面版

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

默认目标为 macOS arm64，默认输出目录为 `packages/desktop/dist/`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

macOS 安装：打开构建产物 DMG，将 CodeVori 拖入“应用程序”。签名与公证状态取决于构建配置。

#### macOS 提示“App 已损坏，无法打开”

未经 Apple 公证的应用可能被 macOS 安全检查拦截，并提示“App 已损坏，无法打开”。仅在确认应用来自本项目的 [GitHub Releases](https://github.com/caiqiqqq/CodeVori/releases)、并已核对 `SHA256SUMS` 中的校验值后，才可在终端移除应用的隔离属性，再重新打开：

```bash
xattr -d com.apple.quarantine "/Applications/CodeVori.app"
```

如果仍被隔离属性拦截，可使用 `xattr -rd com.apple.quarantine "/Applications/CodeVori.app"` 递归处理应用包内文件；若提示权限不足，再在命令前加 `sudo`。安装位置不同时，请替换为实际路径。

此操作会移除下载隔离标记，不会修复真正损坏的文件。来源不明、校验不一致或处理后仍无法打开时，请勿继续绕过安全检查，应重新下载或反馈问题。

### CodeVori 命令行版

构建入口为 `pnpm build:zcode`。脚本会依次构建 CLI/TUI、后端和 Web，收集 TUI 的原生库、worker 与运行时依赖，再组装发行包；运行发行包仍需要 Node.js，版本以 `mise.toml` 为准。

打包前必须设置下载根地址 `ZCODE_DIST_BASE_URL`（可放在 `.env`、`.env.local` 或环境变量中），也可以通过 `--base-url` 传入。以下地址是占位示例，发布时替换为实际托管地址：

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# 已配置 ZCODE_DIST_BASE_URL 时
pnpm build:zcode

# 仅重新组包，复用已有的 Agent、后端和 Web 构建产物
pnpm build:zcode --skip-build

# 查看版本、输出目录等可选参数
pnpm build:zcode --help
```

默认版本取根目录 `package.json`，输出目录为 `dist/zcode/`：

- `releases/<version>/zcode-<version>.tar.gz`：运行包。
- `releases/<version>/sha256.txt`：校验摘要。
- `latest.json`、`install.sh`：版本索引和安装脚本。

完整目录可上传到配置的下载根地址。安装脚本从该地址下载运行包，默认安装到 `~/.zcode/runtime`，并在 `~/.local/bin` 创建 `zcode` 命令。安装目录可通过 `ZCODE_DIST_HOME` 修改，命令目录可通过 `ZCODE_DIST_BIN_DIR` 修改。

旧 Lite 用户需要改用上述构建命令、环境变量和新的安装脚本。新安装不会删除旧 Lite 目录，也不会迁移或删除已有会话数据。

本地调试打包产物时，可直接解压运行，无需上传或安装：

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# 默认启动 TUI
node dist/zcode/debug/zcode/bin/zcode.mjs

# 启动 Web
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

浏览器打开 `http://127.0.0.1:3030`，即可验证同一后端服务托管 Web 页面和 Agent 的完整链路。该端口需要空闲；如正在运行 `pnpm dev:web`，可改用其他 `--port`。

## 仓库结构

| 目录                                                 | 职责                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包   |
| `packages/web`                                       | Web 客户端                                 |
| `packages/server`                                    | HTTP / WebSocket 服务与远程连接            |
| `packages/zcode-server-cli`                          | 独立 Server 启动与进程管理                 |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态     |
| `packages/services`                                  | 业务服务与持久化                           |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现              |
| `apps/zcode-cli`                                     | Agent CLI、TUI、运行时与工具               |
| `apps/mobile`                                        | Expo 手机应用与 WebView 连接壳             |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料     |

## 开发检查

提交改动前，按变更范围运行对应验证。仓库通用检查入口如下：

```bash
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm architecture:check --changed
```

各包的测试入口以其 `package.json` 和实际测试文件为准。新增或调整行为前，先更新对应的 [功能规范](docs/specs/)，并遵守 [AGENTS.md](AGENTS.md) 中的开发约定。

## 来源与致谢

- [ZCode](https://github.com/zai-org/ZCode)：CodeVori 二次开发的基础项目，保留其原作者署名与许可信息。
- [Codeg](https://github.com/xintaofei/codeg)：本项目部分功能的参考来源，包括多智能体协作、智能体配置及任务工作流等方面的设计；实际使用的第三方资源以仓库声明为准。
- 感谢相关智能体适配器、协议、依赖库及其他开源项目的贡献者。具体组件与许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 许可与项目声明

本仓库第一方代码使用 [Apache License 2.0](LICENSE)。第三方软件、图标和其他资源按各自许可证使用与分发；CodeVori 的名称与界面调整不替代原作者和第三方的版权声明。

功能范围、执行权限、网络行为、本地数据与日志等说明见 [NOTICE.md](NOTICE.md)。
