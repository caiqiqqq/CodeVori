# iOS 启动生命周期

## 行为

手机壳在 iOS 27 及以上必须使用 UIKit Scene Lifecycle 启动 React Native 根视图；Release 包仍须内置 `main.jsbundle`，不依赖 Metro。

## 所有者与边界

- Expo config plugin 负责生成 `UIApplicationSceneManifest`，并把 `EXExpoAppSceneDelegate` 注册为场景代理。
- `AppDelegate` 继续负责创建 Expo React Native factory；场景代理负责把窗口和冷启动事件交给 factory。
- WebView、连接配置和快捷消息页面不参与原生启动生命周期。

## 失败语义

缺少 Scene Lifecycle 时，iOS 27 会在创建场景阶段触发 `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`，应用在 WebView 挂载前退出。修复必须先让原生进程稳定启动，再验证 WebView 和远程页面。

## 验收场景

1. Release 构建成功，产物包含 `main.jsbundle`。
2. iPhone 真机启动后进程保持运行，不生成新的 CodeVori 崩溃日志。
3. 已保存连接配置时显示远程 WebView；没有连接配置时显示配对页面。
4. 不修改快捷消息 UI 的布局或交互契约。
