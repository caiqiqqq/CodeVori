import { homedir, platform, tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { PRODUCT_NAME } from "@zcode/shared/product-brand";

/** SEA 资源由包内清单重建；新旧产品必须使用不同的解压缓存。 */
export function resolveSeaRuntimeCacheBase(options: {
  home?: string;
  localAppData?: string;
  platform?: NodeJS.Platform;
  xdgCacheHome?: string;
} = {}): string {
  const home = options.home ?? homedir();
  const currentPlatform = options.platform ?? platform();
  const productDirectory = PRODUCT_NAME.toLowerCase();
  if (currentPlatform === "darwin" && home) {
    return join(home, "Library", "Caches", productDirectory, "sea-assets");
  }
  if (currentPlatform === "win32") {
    return win32.join(
      options.localAppData ?? process.env.LOCALAPPDATA ?? win32.join(home || tmpdir(), "AppData", "Local"),
      productDirectory,
      "Cache",
      "sea-assets",
    );
  }
  return join(
    options.xdgCacheHome ?? process.env.XDG_CACHE_HOME ?? join(home || tmpdir(), ".cache"),
    productDirectory,
    "sea-assets",
  );
}
