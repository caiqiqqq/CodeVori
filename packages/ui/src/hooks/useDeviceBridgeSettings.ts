import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceBridgeCommand, DeviceBridgeState } from "@zcode/shared";
import { usePlatform } from "./usePlatform.js";

export function useDeviceBridgeSettings() {
  const platform = usePlatform();
  const [state, setState] = useState<DeviceBridgeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const live = useRef(false),
    pending = useRef(false),
    reading = useRef(false),
    sequence = useRef(0);
  const read = useCallback(async () => {
    if (pending.current || reading.current) return;
    reading.current = true;
    const current = ++sequence.current;
    try {
      const value = await platform.getDeviceBridgeState?.();
      if (value && live.current && current === sequence.current) setState(value);
    } catch {
      if (live.current && current === sequence.current) setError(true);
    } finally {
      reading.current = false;
    }
  }, [platform]);
  useEffect(() => {
    live.current = true;
    void read();
    const timer = setInterval(() => {
      void read();
    }, 3000);
    return () => {
      live.current = false;
      sequence.current++;
      clearInterval(timer);
    };
  }, [read]);
  const run = useCallback(
    async (command: DeviceBridgeCommand) => {
      if (pending.current || !platform.executeDeviceBridgeCommand) return;
      pending.current = true;
      const current = ++sequence.current;
      setBusy(true);
      setError(false);
      try {
        const next = await platform.executeDeviceBridgeCommand(command);
        if (live.current && sequence.current === current) setState(next);
      } catch {
        if (live.current && sequence.current === current) {
          setError(true);
          const actual = await platform.getDeviceBridgeState?.().catch(() => undefined);
          if (actual && live.current && sequence.current === current) setState(actual);
        }
      } finally {
        pending.current = false;
        if (live.current) setBusy(false);
      }
    },
    [platform],
  );
  const selectComponent = useCallback(async () => {
    try {
      const path = await platform.selectFile();
      if (path && live.current) await run({ action: "configure", binaryPath: path });
    } catch {
      if (live.current) setError(true);
    }
  }, [platform, run]);
  return { state, busy, error, run, selectComponent };
}
