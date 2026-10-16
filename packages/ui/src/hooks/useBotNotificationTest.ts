import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServices } from "@/hooks/useServices.js";

/** 测试结果只属于当前机器人；切换目标或卸载后不采纳迟到回复。 */
export function useBotNotificationTest(botId: string) {
  const { botsService } = useServices();
  const owner = useMemo(() => ({}), [botsService, botId]);
  const current = useRef<object | null>(owner);
  current.current = owner;
  const pending = useRef<object | null>(null);
  const [state, setState] = useState<{ owner: object; testing: boolean; ok?: boolean } | null>(
    null,
  );
  useEffect(() => {
    current.current = owner;
    return () => {
      if (current.current === owner) current.current = null;
    };
  }, [owner]);
  const sendTest = useCallback(async () => {
    if (pending.current === owner) return;
    pending.current = owner;
    setState({ owner, testing: true });
    try {
      const result = await botsService.testTaskNotification(botId);
      if (current.current === owner) setState({ owner, testing: false, ok: result.ok });
    } catch {
      if (current.current === owner) setState({ owner, testing: false, ok: false });
    } finally {
      if (pending.current === owner) pending.current = null;
    }
  }, [owner, botId, botsService]);
  return {
    testing: state?.owner === owner && state.testing,
    ok: state?.owner === owner ? state.ok : undefined,
    sendTest,
  };
}
