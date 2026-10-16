# CodeVori Mobile

Expo 手机壳。通过 WebView 连接 CodeVori 的局域网页面，手机不运行 Agent。

连接后网页占满安全区，不常驻显示地址栏。需要查看或更换电脑时，轻点 `⋮` 连接设置入口；可拖动它调整位置，本次 App 会话内保留位置。选择“继续使用”保留当前网页，选择“更换连接”才清除手机保存的凭据并返回连接页。

更新后的桌面 LAN Web 在断线后会有限次数尝试重连；回到 App 前台或恢复网络时再尝试。电脑需保持运行，授权失效时需要重新配对。健康页面回到前台不会主动刷新；iOS 回收网页进程时会重建 WebView。此恢复能力需要电脑端同时更新其提供的 Web 资源。

要与当前桌面窗口使用同一个项目列表及会话，在包含本次修改的桌面版本中打开 **设置 → 局域网手机访问**，填写一个局域网 IPv4 地址或解析到本机的自定义域名及固定端口，点击 **保存配置 → 开启访问**。手机浏览器直接打开其中的完整连接地址；手机 App 可以粘贴完整链接、分别输入根地址与 Token，或点击“扫描二维码”扫描该页面的局域网二维码。扫码后先填入地址，点击“连接桌面端”才保存和连接。拒绝相机权限时仍可手动输入。项目及排序跟随所选桌面窗口，手机草稿和当前阅读位置仍独立；关闭访问、关闭窗口或退出桌面会断开手机。地址、端口及加密保存的访问凭据在重新开启、重启或更新后保持不变。修改地址与端口前先关闭访问；端口被占用时会报错，不会自动更换。若路由器改变电脑 IP，需更新地址或在路由器保留固定 IP。

桌面开发启动会构建同版本 Web 资源；桌面发行构建将其放入 `out/web` 一起打包。手动只启动 Electron 开发 runtime 前，先执行 `pnpm --filter @zcode/web build`。

下面的 `zcode --web` 是独立 Web 服务模式，可以单独使用，但不会同步正在运行的桌面窗口。此壳不扫描旧的 `/remote/v4` 二维码。

## 运行

仓库根目录使用 `mise.toml` 指定的 Node 24.14.0 / pnpm 10.33.2，安装依赖后：

```bash
pnpm install
zcode --web --host 0.0.0.0 --port 3030 --no-open
pnpm --filter @zcode/mobile start
```

`zcode --web` 在非本机监听时默认生成访问 Token。可粘贴输出的完整 `http(s)://host:port/?token=...` 链接（Token 输入框留空），或者填写根地址，例如 `http://192.168.1.23:3030`，再将 Token 单独填入第二个输入框。手机与电脑需要处于同一可互访网络。应用会使用现有服务器的 `?token=` 首次换取 HttpOnly cookie。若本机 `zcode` 不是此仓库构建版本，先按根目录 README 的发行包说明确认命令来源和版本。

开发阶段用 `pnpm --filter @zcode/mobile android` 或 `pnpm --filter @zcode/mobile ios` 生成并运行相应原生工程。需要 Android SDK 或完整 Xcode；这里没有提交生成的原生目录。`pnpm --filter @zcode/mobile typecheck`、`pnpm --filter @zcode/mobile test` 可检查手机壳源码。真机安装包仍需签名及平台构建环境。

局域网 HTTP 仅用于可信网络；HTTP 会以明文传送首次连接的 Token。自定义域名同样支持 HTTP；域名需要正确解析并能从手机访问电脑的固定端口，公网使用建议通过 HTTPS 代理。移动壳不会接管 OAuth 流程：如果 Web 页面首次要求登录，应先在手机浏览器确认同一地址能完成登录，不能把手机 WebView 的连接成功等同于 OAuth 或完整会话已验收。

手机显示名通过 `app.config.ts` 读取共享产品名，图标由 `pnpm --filter @zcode/mobile generate:icon` 从共享 V 字形生成。修改后需要重新生成原生资源并构建安装，Metro 热更新不会修改主屏名称和图标。
