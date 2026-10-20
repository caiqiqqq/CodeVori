import { Emitter } from "@zcode/rpc";
import { randomUUID } from "node:crypto";
import {
  acpAgentOperationCancelSchema,
  type AcpAgentManagement,
  type AcpAgentManagementSnapshot,
  type AcpAgentOperationCancel,
  type AcpAgentOperationEvent,
} from "@zcode/shared";
import { sanitizeAcpInstallLog } from "./acpInstallProcess.js";

/** 目标 Host 的唯一 admission；UI 只读取快照，不能用请求 finally 推断空闲。 */
export class AcpAgentOperations {
  private snapshot: AcpAgentManagementSnapshot = {
    ownerId: randomUUID(),
    sequence: 0,
    operation: null,
  };
  private controller = new AbortController();
  private disposed = false;
  readonly changed = new Emitter<AcpAgentManagementSnapshot>();
  readonly events = new Emitter<AcpAgentOperationEvent>();
  read = (): AcpAgentManagementSnapshot => structuredClone(this.snapshot);

  private publish() {
    this.snapshot.sequence++;
    this.changed.fire(this.read());
  }

  begin(input: AcpAgentManagement): AbortSignal {
    if (this.disposed) throw new Error("ACP manager closed");
    if (this.snapshot.operation?.busy) throw new Error("ACP package operation already running");
    this.controller = new AbortController();
    const { operationId, agent, action } = input;
    this.snapshot.operation = {
      operationId,
      agent,
      action,
      status: "running",
      busy: true,
      cancellable: false,
      log: [],
    };
    this.publish();
    return this.controller.signal;
  }

  emit(phase: AcpAgentOperationEvent["phase"], message: string) {
    const operation = this.snapshot.operation!;
    const safe = sanitizeAcpInstallLog(message);
    operation.log = [...operation.log.slice(-99), safe];
    this.publish();
    this.events.fire({
      operationId: operation.operationId,
      agent: operation.agent,
      phase,
      message: safe,
    });
  }

  setCancellable(value: boolean) {
    this.snapshot.operation!.cancellable = value;
    this.publish();
  }

  finish(failed: boolean, cleanupFailed = false) {
    const operation = this.snapshot.operation!;
    operation.status = "failed";
    if (!failed) operation.status = "completed";
    operation.busy = cleanupFailed;
    operation.cancellable = false;
    this.publish();
  }

  cancel(input: AcpAgentOperationCancel) {
    const { operationId } = acpAgentOperationCancelSchema.parse(input);
    const operation = this.snapshot.operation;
    if (!operation?.busy || operation.operationId !== operationId)
      throw new Error("安装操作已结束或 ID 已过期");
    if (operation.status === "cancelling") return;
    if (!operation.cancellable) throw new Error("当前安装阶段不支持取消");
    operation.status = "cancelling";
    operation.cancellable = false;
    this.publish();
    this.controller.abort();
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
    this.events.dispose();
    this.changed.dispose();
  }
}
