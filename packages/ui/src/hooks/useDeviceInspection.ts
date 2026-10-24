import { useCallback, useEffect, useRef, useState } from "react";
import {
  deviceInspectionResultSchema,
  type DeviceInspectionResult,
  type DeviceSystemStatus,
} from "@zcode/shared";
import { usePlatform } from "./usePlatform.js";

type Screen = Extract<DeviceInspectionResult, { kind: "screen" }>;
export function useDeviceInspection(nodeId: string) {
  const platform = usePlatform();
  const [system, setSystem] = useState<DeviceSystemStatus | null>(null),
    [screen, setScreen] = useState<Screen | null>(null);
  const [busy, setBusy] = useState({ system: false, screen: false }),
    [errors, setErrors] = useState({ system: false, screen: false });
  const epoch = useRef(0),
    pending = useRef({ system: false, screen: false });
  const read = useCallback(
    async (kind: "system" | "screen") => {
      if (pending.current[kind] || !platform.inspectDeviceBridge) return;
      const generation = epoch.current;
      pending.current[kind] = true;
      setBusy((v) => ({ ...v, [kind]: true }));
      try {
        const result = deviceInspectionResultSchema.parse(
          await platform.inspectDeviceBridge({ nodeId, kind }),
        );
        if (result.nodeId !== nodeId || result.kind !== kind) throw Error("unexpected_observation");
        if (epoch.current !== generation) return;
        if (result.kind === "system") setSystem(result.status);
        else setScreen(result);
        setErrors((v) => ({ ...v, [kind]: false }));
      } catch {
        if (epoch.current === generation) {
          if (kind === "system") setSystem(null);
          else setScreen(null);
          setErrors((v) => ({ ...v, [kind]: true }));
        }
      } finally {
        if (epoch.current === generation) {
          pending.current[kind] = false;
          setBusy((v) => ({ ...v, [kind]: false }));
        }
      }
    },
    [platform, nodeId],
  );
  useEffect(() => {
    epoch.current++;
    pending.current = { system: false, screen: false };
    setSystem(null);
    setScreen(null);
    setErrors({ system: false, screen: false });
    setBusy({ system: false, screen: false });
    const poll = () => {
      if (document.visibilityState !== "hidden") void read("system");
    };
    poll();
    const timer = setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      epoch.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [read]);
  return { system, screen, busy, errors, read };
}
