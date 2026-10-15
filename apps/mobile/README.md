# ZCode LAN Mobile

Expo 手机壳。通过 WebView 连接 ZCode 的局域网页面，手机不运行 Agent。

要与当前桌面窗口使用同一个项目列表及会话，在包含本次修改的桌面版本中打开 **设置 → 局域网手机访问 → 开启访问**。手机浏览器直接打开其中的完整连接地址；手机 App 分别输入根地址和界面中的 Token。项目及排序跟随所选桌面窗口，手机草稿和当前阅读位置仍独立；关闭访问、关闭窗口或退出桌面会断开手机。访问凭据每次重新开启都会更换。

桌面开发启动会构建同版本 Web 资源；桌面发行构建将其放入 `out/web` 一起打包。手动只启动 Electron 开发 runtime 前，先执行 `pnpm --filter @zcode/web build`。

下面的 `zcode --web` 是独立 Web 服务模式，可以单独使用，但不会同步正在运行的桌面窗口。此壳不扫描旧的 `/remote/v4` 二维码。

## 运行

仓库根目录使用 `mise.toml` 指定的 Node 24.14.0 / pnpm 10.33.2，安装依赖后：

```bash
pnpm install
zcode --web --host 0.0.0.0 --port 3030 --no-open
pnpm --filter @zcode/mobile start
```

`zcode --web` 在非本机监听时默认生成访问 Token。把它输出的网址**仅填写协议、局域网 IP 和端口**，例如 `http://192.168.1.23:3030`；把 Token 单独填入 App 的第二个输入框。手机与电脑需要处于同一可互访网络。应用会使用现有服务器的 `?token=` 首次换取 HttpOnly cookie。若本机 `zcode` 不是此仓库构建版本，先按根目录 README 的发行包说明确认命令来源和版本。

开发阶段用 `pnpm --filter @zcode/mobile android` 或 `pnpm --filter @zcode/mobile ios` 生成并运行相应原生工程。需要 Android SDK 或完整 Xcode；这里没有提交生成的原生目录。`pnpm --filter @zcode/mobile typecheck`、`pnpm --filter @zcode/mobile test` 可检查手机壳源码。真机安装包仍需签名及平台构建环境。

局域网 HTTP 仅用于可信网络；HTTP 会以明文传送首次连接的 Token。公网地址需要 HTTPS。移动壳不会接管 OAuth 流程：如果 Web 页面首次要求登录，应先在手机浏览器确认同一地址能完成登录，不能把手机 WebView 的连接成功等同于 OAuth 或完整会话已验收。
