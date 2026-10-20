import { fileURLToPath } from "node:url";
import { createOpenComputerUseMcpServer } from "@zcode/zcode-cua/open-mcp";

// 插件宿主调用 main()；不能在 import 阶段启动，否则宿主校验失败时仍会残留连接。
export async function main() {
  const server = createOpenComputerUseMcpServer({
    // 运行时必须消费同一插件的 native；不读取工作区指定的 executable 或上游环境覆盖。
    executable: fileURLToPath(new URL("../native/OpenZCodeNative", import.meta.url)),
  }).listen();
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
