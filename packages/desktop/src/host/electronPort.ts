import type { MessagePortMain } from "electron";
import { wrapNodeMessagePort, type MessagePortLike } from "@zcode/rpc";

/**
 * 将 Electron MessagePortMain 适配为 RPC 层的 MessagePortLike 接口。
 *
 * Electron 的 MessagePortMain 使用 Node EventEmitter 风格 (.on/.off)，
 * 而 MessagePortLike 使用 Web 标准风格 (addEventListener/removeEventListener)。
 * 此适配器弥合两者差异，使 MessagePortProtocol 可以直接在 utilityProcess 中使用。
 */
export function wrapElectronPort(port: MessagePortMain): MessagePortLike {
  return wrapNodeMessagePort(port);
}
