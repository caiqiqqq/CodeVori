import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { forgeErrorId } from "@/lib/forgePanel.js";

export function useForgeMutation(scope: object | null) {
  const token = useMemo(() => ({}), [scope]);
  const generation = useRef(0);
  const admitted = useRef(false);
  const [state, setState] = useState({ token, busy: false, error: null as string | null });
  useLayoutEffect(() => {
    generation.current += 1;
    admitted.current = false;
    setState({ token, busy: false, error: null });
    return () => {
      generation.current += 1;
    };
  }, [token]);
  const run = useCallback(
    async <T>(operation: () => Promise<T>): Promise<{ value: T } | null> => {
      if (!scope || admitted.current) return null;
      admitted.current = true;
      const current = generation.current;
      setState({ token, busy: true, error: null });
      try {
        const value = await operation();
        return generation.current === current ? { value } : null;
      } catch (error) {
        if (generation.current === current)
          setState({ token, busy: true, error: forgeErrorId(error) });
        return null;
      } finally {
        // 旧 Host 的迟到回包不能关闭新 Host 的弹窗或解锁其正在提交的评论。
        if (generation.current === current) {
          admitted.current = false;
          setState((previous) => ({ ...previous, busy: false }));
        }
      }
    },
    [scope, token],
  );
  return {
    run,
    busy: state.token === token && state.busy,
    error: state.token === token ? state.error : null,
  };
}
