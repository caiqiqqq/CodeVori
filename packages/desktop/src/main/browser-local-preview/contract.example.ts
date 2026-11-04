/**
 * Desktop 本地预览授权接口的最小调用示例。
 */
import type { BrowserLocalPreviewContract } from "./contract.js";

export async function exampleBrowserLocalPreview(
  contract: BrowserLocalPreviewContract,
): Promise<string> {
  return contract.resolveNavigation("file:///Users/dev/preview/index.html");
}
