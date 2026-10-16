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
  plugins: config.plugins?.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === "expo-camera"
      ? [
          plugin[0],
          {
            ...plugin[1],
            cameraPermission: `允许 ${PRODUCT_NAME} 使用相机扫描桌面端局域网连接二维码。`,
          },
        ]
      : plugin,
  ),
});
