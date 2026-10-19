import type { ConfigContext, ExpoConfig } from "expo/config";
import { PRODUCT_NAME } from "@zcode/shared/product-brand";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: PRODUCT_NAME,
  slug: config.slug ?? "zcode-lan-mobile",
  ios: {
    ...config.ios,
    // HTTP 域名由 app.json 的 WebView 专用 ATS 键放行；本地网络键会让通用开关失效。
    infoPlist: {
      ...config.ios?.infoPlist,
      NSLocalNetworkUsageDescription: `用于连接同一局域网内运行的 ${PRODUCT_NAME} Web 服务。`,
    },
  },
  plugins: config.plugins?.map((plugin) => {
    if (!Array.isArray(plugin)) return plugin;
    if (plugin[0] === "expo-camera") {
      return [
        plugin[0],
        {
          ...plugin[1],
          cameraPermission: `允许 ${PRODUCT_NAME} 使用相机扫描桌面端局域网连接二维码。`,
        },
      ];
    }
    if (plugin[0] === "expo-build-properties") {
      // iOS 27 会在未采用 Scene Lifecycle 的应用创建场景时主动触发 SIGTRAP；
      // 由 Expo 57 的官方 config plugin 生成场景代理，保留现有 Android 明文网络配置。
      return [
        plugin[0],
        {
          ...plugin[1],
          ios: {
            ...plugin[1]?.ios,
            enableSceneSupport: true,
          },
        },
      ];
    }
    return plugin;
  }),
});
