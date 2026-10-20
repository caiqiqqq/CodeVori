import { useCallback, useEffect, useRef, useState } from "react";
import type { IAcpService } from "@zcode/services";
import { acpAgentManagementSnapshotSchema, type AcpAgentManagementSnapshot } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** Host 内存事实的投影；subscribe-before-read + sequence 防止快照覆盖较新的事件。 */
export function useAcpOperationSnapshot(
  service: IAcpService | null,
  supported: boolean,
  onFinished: () => void,
) {
  const { intl } = useZCodeIntl();
  const [snapshot, setSnapshot] = useState<AcpAgentManagementSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState(service);
  const currentService = useRef(service);
  currentService.current = service;
  const generation = useRef(0);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const finished = useRef(onFinished);
  finished.current = onFinished;
  useEffect(() => {
    ++generation.current;
    setSnapshot(null);
    setError(null);
    if (!service || !supported) return;
    let active = true;
    let sequence = -1;
    let ownerId: string | undefined;
    const retiredOwners = new Set<string>();
    let eventRevision = 0;
    let running = false;
    let reading: Promise<void> | undefined;
    const accept = (raw: AcpAgentManagementSnapshot, readRevision?: number) => {
      if (!active) return;
      const parsed = acpAgentManagementSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        setError(intl.formatMessage({ id: "settings.acpAgents.invalidSnapshot" }));
        return;
      }
      const value = parsed.data;
      if (retiredOwners.has(value.ownerId)) return;
      // 读取期间发生了实例切换事件时，不让旧 RPC 回执重新认领已经失效的 Host。
      if (
        ownerId &&
        ownerId !== value.ownerId &&
        readRevision !== undefined &&
        readRevision !== eventRevision
      )
        return;
      if (ownerId !== value.ownerId) {
        if (ownerId) retiredOwners.add(ownerId);
        if (retiredOwners.size > 16) retiredOwners.delete(retiredOwners.values().next().value!);
        ownerId = value.ownerId;
        sequence = -1;
      }
      setError(null);
      if (value.sequence <= sequence) return;
      sequence = value.sequence;
      setSnapshot(value);
      setSource(service);
      if (running && !value.operation?.busy) finished.current();
      running = value.operation?.busy === true;
    };
    const read = () => {
      if (!reading) {
        const revision = eventRevision;
        reading = service
          .readAgentManagement()
          .then((value) => accept(value, revision))
          .catch((cause: unknown) => {
            if (active) setError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            reading = undefined;
          });
      }
      return reading;
    };
    refresh.current = read;
    let subscription: { dispose(): void } | undefined;
    try {
      subscription = service.onDynamicAgentManagement()((value) => {
        eventRevision++;
        accept(value);
      });
    } catch {
      setError(intl.formatMessage({ id: "settings.acpAgents.snapshotUnavailable" }));
    }
    void read();
    // 手机断线可能漏掉最终事件；有界单飞读取修复缺口，不以本地 timeout 推断任务结束。
    const timer = setInterval(() => {
      void read();
    }, 3000);
    return () => {
      ++generation.current;
      active = false;
      clearInterval(timer);
      subscription?.dispose();
      refresh.current = async () => {};
    };
  }, [service, supported, intl]);

  const refreshOperation = useCallback(() => refresh.current(), []);
  const cancel = useCallback(async () => {
    const operation = source === service ? snapshot?.operation : null;
    if (!service || !operation?.cancellable) return;
    const currentGeneration = generation.current;
    try {
      await service.cancelAgentOperation({ operationId: operation.operationId });
      if (generation.current === currentGeneration && currentService.current === service)
        await refresh.current();
    } catch (cause) {
      if (generation.current === currentGeneration && currentService.current === service)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [service, source, snapshot]);
  const currentSnapshot = source === service ? snapshot : null;
  return {
    snapshot: currentSnapshot,
    error: source === service ? error : null,
    refreshOperation,
    cancel,
    busy:
      supported && (!currentSnapshot || Boolean(currentSnapshot.operation?.busy) || Boolean(error)),
  };
}
