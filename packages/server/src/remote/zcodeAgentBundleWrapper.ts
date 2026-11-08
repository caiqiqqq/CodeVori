// 远端 ZCode Agent 以「独立 node + 编译产物 codevori.cjs」的形态运行，而不是各平台内嵌 node 的原生二进制。
// 远端部署时本来就有一份独立 node（用于跑 codevori-server.cjs），agent 复用它执行 codevori.cjs 即可。
//
// 部署布局：把发布制品 codevori.cjs 安装为 agents/<provider>/codevori.cjs，再写可执行 wrapper —— 就是 resolver
// 期望找到的可执行入口（如 agents/glm/codevori-agent）—— 由它用远端 node 执行 codevori.cjs。
// 这样 provider runtime resolver 不需要区分原生/JS，照旧找 codevori-agent 这个可执行文件即可。
// 开发态与生产态共用同一份 wrapper 语义。

import { PRODUCT_DATA_DIRECTORY_NAME } from "@zcode/shared";

// 修复原因：远端可继续读取旧名发布制品，实际部署入口必须与 ZCode 分开。
export const REMOTE_AGENT_BUNDLE_NAME = "codevori.cjs";

export function buildRemoteAgentBundleWrapper(runtimeResourceDir: string): string {
  return [
    "#!/bin/sh",
    "set -eu",
    `runtime_root="\${ZCODE_SERVER_RUNTIME_ROOT:-$HOME/${PRODUCT_DATA_DIRECTORY_NAME}/server}"`,
    `exec "$runtime_root/node" "$runtime_root/agents/${runtimeResourceDir}/${REMOTE_AGENT_BUNDLE_NAME}" "$@"`,
    "",
  ].join("\n");
}

export function isRemoteAgentBundleWrapperCurrent(
  content: string,
  runtimeResourceDir: string,
): boolean {
  return content.replace(/\r\n/g, "\n") === buildRemoteAgentBundleWrapper(runtimeResourceDir);
}
