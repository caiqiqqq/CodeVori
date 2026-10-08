import { zcodeProtocolMethods, zcodeProtocolEmptyResultSchema } from "@zcode/shared";
import type { ZCodeProtocolAgentServerContext } from "./server-types.js";

/** 委派生命周期发生在已校验的 stop/close 边界，不依据 Renderer 的旧快照暂停。 */
export async function pauseHostDelegations(
  context: ZCodeProtocolAgentServerContext,
  sessionId: string,
) {
  await context
    .requestClient(
      zcodeProtocolMethods.interactionPauseDelegations,
      { sessionId },
      zcodeProtocolEmptyResultSchema,
      { timeoutMs: 5000 },
    )
    .catch(() => undefined);
}
