# 开源 macOS 电脑控制

## 来源和边界

- 引入 `https://github.com/hqhq1025/open-zcode-computer-use` 的固定提交 `202395e65218f83086b30daceb0f11d2f3430dd8`，保留 MIT LICENSE、NOTICE、来源提交及本地修改说明。仅导入独立 JavaScript MCP/控制实现、Swift 原生源码和测试；不导入逆向工具、官方二进制或签名材料。
- 以现有 `computer-use@zcode-plugins-official` 插件为唯一用户入口，默认关闭，复用设置页、输入框入口、插件引用及会话工具结果。不新增聊天页或第二个插件开关。
- 支持本地 macOS 14+、arm64/x64。Windows、Linux、远程工作区和普通 Web 不宣称具备本机控制能力；跨平台构建跳过 Swift。远程资产不包含本机控制插件。
- 通过普通 stdio MCP 暴露上游的 30 个工具。它不是官方签名 CUA broker，不能因为插件名相同而获得官方 CUA authority、凭据、免审批或 provider 特权。API/ZCode 仍使用现有 MCP 权限规则；ACP 经既有普通插件 MCP 投影，保留 Agent 自己的审批规则。
- 原有 API/ACP 模型、会话身份、工作树、插件及技能注入不改变。已存在连接的插件快照不热替换；启停后使用新连接。手机复用桌面已有会话的调用和事件，不启动手机专属执行器。
- 不提供上游没有的产品 PiP、官方 Helper 安装/签名逻辑或 Windows 实现。物理鼠标移动和分离按下/抬起保持禁止，避免遗留按键状态越过跨进程互斥边界；优先 AX 和 PID 定向操作。

## 入口可见性与导航

- 桌面设置侧栏在「浏览器控制」后显示「电脑控制」，不依赖插件启用态、权限状态或输入框按钮偏好。全局设置隐藏名单不得屏蔽该分区，避免没有入口可以启用插件。
- 输入框直达、设置页内跳转及上次分区记忆都保留 `computerUse` 目标，由既有设置导航意图和平台配置解析，不新增路由或设置状态所有者。
- 普通 Web 和手机不显示本机控制设置菜单；直接跳转时由平台可见分区校验回退到通用设置。Windows、Linux 和远程工作区保留桌面设置菜单，但进入后展示不支持说明，不提供本机控制开关。
- 插件默认关闭，输入框入口默认隐藏。恢复设置菜单不自动启用插件、不覆盖用户显隐偏好、不申请系统权限或执行截图；需要用户在该分区显式启用及授权。

```text
设置菜单 / 输入框直达 / 上次分区记忆
                  -> 设置导航意图 -> 平台可见分区 -> 电脑控制设置
                                                       |
                                     用户显式操作 -> 既有插件/设置所有者
```

## 所有者和调用顺序

```text
设置插件启停 -> 现有 CLI 插件注册/缓存 -> 当前 Host 的会话 MCP 快照
                           |                 |
                           |          API/ZCode 或 ACP Agent 审批
                           |                 |
                           +-> stdio MCP 参数校验 / 主智能体检查
                                            |
                                MCP 进程持有会话状态/停止锁存
                                            |
                               同一用户桌面的跨进程工具互斥
                                            |
                              Swift AX / 截图 / PID 定向输入
                                            |
                               现有工具事件 / 会话快照 / UI

desktop-continuous: 实时工具事件 ---+
                                  +--- 同一会话所有者
web-remote-replayable: 快照/补播 ---+
```

- 上游 `ComputerUseService` 是 state/frame 注册、动作校验及 stop latch 的唯一所有者。每个 MCP 连接拥有隔离的原生 session；不存在 Renderer 的第二份控制状态。
- stdio 握手和工具枚举不启动原生进程、不请求 OS 权限、不操作桌面。首次有效工具请求才启动 Swift。
- 使用 `proper-lockfile` 的跨进程互斥保护整个工具事务，锁由调用者释放；争用立即返回结构化 busy 错误，不排隐形队列或用固定等待掩盖竞争。进程异常退出后的过期锁由库回收。
- 断连/取消阻止后续请求并关闭 native session；禁止自动重试可能已经发送的输入。关闭等待在途操作，释放互斥及临时图片目录。停止控制在当前 MCP 连接中锁存，不能自动恢复。
- 原生启动被拒绝或执行器异常退出时封住失效连接；没有成功产生 PID 的启动失败不等待不存在的 `exit` 事件，清理临时目录并释放锁。请求超时则等待实际执行器退出后才释放锁。
- workspace 身份仍使用 `workspaceIdentity?.trim() || workspacePath`。MCP 快照由对应 Host 解析；不将本机路径、权限状态或旧连接结果回填到远端 workspace。

## 权限和构建

- 保留现有 `ICuaPermissionService` RPC 契约，macOS 本地 Host 通过开源 native 的只读预检读取 Accessibility / Screen Recording。缺失/不支持/构建失败明确返回不可用，不伪造 granted。
- 实际 OS 授权主体是启动 native 的桌面应用；权限引导及拖拽指向当前运行的 ZCode app bundle，不借用旧版官方 Helper 身份或降低其签名校验。
- macOS 开发启动必须经 LaunchServices 启动已准备的 ZCode Dev bundle，不能直接从编辑器/终端子进程执行 Electron。直接 spawn 会继承调用应用的 TCC responsibility，出现「已授权 ZCode Dev，却检查 Codeg/终端权限」的主体错配。启动沿用当前环境和正常用户数据；不向 LaunchServices 传入依赖开发父进程描述符的 `/dev/stdout` 或 `/dev/stderr` 重定向，避免管道启动时出现 `-10810`，应用日志保留在既有日志目录。退出清理使用精确可执行路径和本次新建的 LaunchServices ASN 身份，排除启动前已有实例，只终止本次应用及其子进程，不依赖会被 process.title 覆盖的 argv 或旧 PID。Windows/Linux 仍使用原有直接启动路径。
- 授权引导和拖拽的文件指纹必须基于物理 bundle 文件，不能使用 Electron ASAR 虚拟目录的合成 inode。`.asar` 作为整个归档文件复核真实 inode/ctime/size；普通资源、Info.plist、可执行文件和签名清单仍需复核。保留「前快照 -> 主体校验 -> 后快照 -> 身份复核 -> 终检」顺序，真实改动仍拒绝授权引导，不通过跳过校验或重试消除误报。
- 仅显式功能验证请求执行截图探针。常规权限查询不截图、不弹系统授权。授权返回通过刷新标记使后续 native 调用使用新进程，不重建 Agent、不重发模型请求。
- 权限适配服务沿用现有 UI 的 `includeFunctionalProbes` 查询契约；同时接受明确的 `probeScreenCapture: true`，显式 `false` 可关闭探针。授权返回的功能验证不能因参数名不匹配而静默退化为只读查询。
- 拖拽浮窗始终提供本地化的关闭按钮。点击关闭由 Main 校验该 IPC sender 是本次浮窗，再取消其关联的协调器会话；所有加入同一会话的参与者收到 canceled，不能获得返回成功或恢复权。普通主窗口不能使用浮窗关闭命令取消其他窗口的引导。
- 关闭立即销毁浮窗，停止定位 watcher、计时器及应用返回监听；不得关闭系统设置、修改 TCC 或自动重开引导。取消/失败后的 UI 只读刷新状态，用户可再次显式打开引导。destroy 为终态，迟到的设置打开或 ready-to-show 不能复活窗口；hide 后迟到 ready-to-show 不能重新显示。
- Main 的应用激活策略由正常桌面应用生命周期管理，权限浮窗只管理自身可见性。macOS 浮窗跨桌面及全屏显示必须设置 `skipTransformProcessType: true`，不得将整个应用转换成 UIElement 或隐藏主程序的 Dock 图标。保留 `type: "panel"`、不可聚焦及非激活显示，不通过反复调用 `app.dock.show()` 抢走系统设置的焦点。打开、隐藏、取消、失败和重试都保持应用原有 Dock 可见性；已运行旧逻辑的开发实例重新加载 Main 后恢复正常应用模式，无需修改用户配置或 TCC。
- 新增 `ZCODE_OPEN_CUA_NATIVE`：仅用于桌面 Main 向本地 Host 指定随包的开源 native 可执行文件；优先于开发态包内产物。错误路径返回不可用，不下载或自动安装工具链。
- 内置播种仅在 macOS 且 Main 注入该路径时进行；独立 CLI、远程 Host 和非 macOS 不自动注册此桌面插件。开发 Agent 和正式安装包都携带同一插件构建产物。
- 插件发现层对该插件身份执行相同的平台和 Host 环境门禁；即使旧缓存存在且启用，也不得在缺少桌面 native 路径或关闭特性时注入 MCP、技能和命令。此校验不删除用户缓存或修改持久化启用态。
- 新增 `ZCODE_OPEN_CUA_PERMISSION_APP_PATH`：Main 从当前进程可执行文件确定的 app bundle，仅用于展示真实授权主体及权限引导；不从用户配置选择待授权应用。
- 上游 `OPEN_ZCODE_CUA_NATIVE` 等环境变量不作为 ZCode 内置插件的隐式覆盖来源。内置 MCP 使用与自己一同分发的 native，避免加载工作区指定的二进制或启用物理指针。
- 内置 MCP 入口导出 `main()`，由现有 `__zcode-plugin-host` 加载；导入模块本身不启动传输或原生进程。
- 源码构建产物不提交；开发和发布准备脚本生成并校验 native/MCP 资产，插件 seed/打包包含其运行依赖和许可证。本地构建优先兼容已有 Swift 工具链，不更改系统工具链。
- macOS 发布签名必须覆盖权限预检用的资源 native 和插件执行用的 native；原有 `glm` 预签名忽略规则对新增插件 native 作精确例外，不重新签名其他预签名运行资产。

## 验收

1. 开关默认关闭；开启后现有插件及技能可发现，API/ZCode 与 ACP 普通 stdio 插件投影均包含同一个电脑控制 MCP。关闭后新连接不再含该服务。
2. 握手/工具列表在 native 缺失时仍可返回 30 个工具；工具首次调用才返回缺失或平台错误。非法参数、子智能体请求、停止后调用不触及 native。
3. mock 与上游用例覆盖 AX/截图、state/frame 过期和消费、停控、发送状态；本地适配测试覆盖懒启动、关闭、并发互斥、失败恢复及环境覆盖隔离。
4. macOS 权限预检、显式探针、权限刷新与 app 授权主体有测试；Windows/Linux/旧 macOS 明确不支持。API/ACP 原有会话与插件测试无回归。
5. 开发/发布构建均包含 MCP、目标架构 native、MIT LICENSE/NOTICE；远程或非 macOS 包不包含可执行的本机控制能力。不能用旧产物或仅有 JS 的残缺 seed 冒充完整功能。
6. 实际执行上游测试、适配测试、可用 E2E、`pnpm typecheck`、`pnpm lint`、CLI 检查及架构检查。权限不足时明确报告不能验证真实点击/截图，不修改 OS 授权或用 mock 冒充实机通过。
7. 插件关闭且输入框入口隐藏时，桌面设置菜单仍可见并能打开原有开关；上次分区记忆和输入框直达不会被全局隐藏名单回退。Web 不显示菜单，直接目标经平台校验回退；其他既有隐藏分区不受影响。E2E 从菜单进入设置而非直接挂载内容，验证进入前不调用权限服务，且导航不会启用插件或修改输入框显隐偏好。
8. 在真实 Electron 文件系统下，包含 `.asar` 的稳定 app 可完成引导校验及拖拽预热；普通资源、归档、可执行文件、Info.plist 的真实改动和身份变化仍阻止打开设置或发放恢复权。测试注入模拟系统设置开关，不访问真实 TCC、截图或用户输入。
9. 启动测试覆盖 macOS LaunchServices 参数和环境、其他平台原路径、只清理精确启动实例；实机只读预检的系统日志应归因到 ZCode Dev，而非编辑器或终端。不将 UI 显示名或旧 TCC 行当作授权成功证据。
10. 浮窗单测覆盖关闭/隐藏与 ready-to-show 的竞态及幂等清理；Electron E2E 覆盖关闭、无授权取消、设置打开失败、再次打开和错误 sender，不修改真实授权或执行截图。共享会话取消后所有参与者均结束，且没有 Helper 重启或授权完成结果。
11. 真实窗口工厂单测校验非激活窗口属性和跨桌面调用不会转换进程类型；macOS Electron E2E 在中文/英文引导打开、关闭、共享取消及设置打开失败前后检查 `app.dock.isVisible()` 保持为真。浮窗仍不可聚焦，测试不得以主动恢复 Dock 的调用掩盖回归。

```text
macOS dev launcher -> LaunchServices -> ZCode Dev responsibility -> Host -> native preflight
                                                                          |
                                                               原有权限服务/共享展示缓存

Main 正常应用模式 / Dock 可见
             |
      浮窗 showInactive -> 跨桌面显示，跳过进程类型转换
             |
      hide / destroy / 重试 -> Main 应用模式及 Dock 可见性不变

浮窗关闭 -> Main sender 校验 -> onboarding coordinator cancel
                                     |
                             所有参与者 canceled
                                     |
                    destroy 浮窗 / watcher / 返回监听
                                     |
                             UI 只读刷新，可显式重试
```
