import { useEffect, useRef, useState } from "react";

/** Draft submission only; accepted task state remains owned by WorkTaskService. */
export function useWorkTaskEditorSave(externalBusy: boolean) {
  const submitting = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = externalBusy || saving;
  useEffect(() => () => controller.current?.abort(), []);

  const submit = async (save: (signal: AbortSignal) => Promise<void>) => {
    if (busy || submitting.current) return;
    // React 提交忙碌状态前可能连续 submit；同步锁覆盖附件上传、保存和重新开始。
    submitting.current = true;
    setSaving(true);
    setError(null);
    const operation = new AbortController();
    controller.current = operation;
    try {
      await save(operation.signal);
    } catch (cause) {
      if (!operation.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      if (!operation.signal.aborted) setSaving(false);
    }
  };
  return { busy, error, submit };
}
