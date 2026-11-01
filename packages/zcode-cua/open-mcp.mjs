import { OpenZCodeMCPServer } from "./vendor/open-zcode-computer-use/src/mcp-server.mjs";
import { NATIVE_TOOLS } from "./native-tools.mjs";
import { createOpenComputerUseService } from "./open-runtime.mjs";

export function createOpenComputerUseMcpServer(options = {}) {
  return new OpenZCodeMCPServer({
    tools: NATIVE_TOOLS,
    input: options.input,
    output: options.output,
    service: options.service ?? createOpenComputerUseService(options),
  });
}
