import { Emitter, type Event } from "@zcode/rpc";
import { constants } from "node:os";

export function resolveRemoteExitCode(code?: number | null, signal?: string | null): number {
  // Node/ssh2 的信号退出没有数字 code；原先的 ?? 0 会让部署和上传把中断当成成功。
  // 对照官方制品共用同一规则：保留数字，已知信号转 128+signal，缺失状态用 255。
  if (typeof code === "number") return code;
  const signalCode = signal ? constants.signals[signal as NodeJS.Signals] : undefined;
  return typeof signalCode === "number" ? 128 + signalCode : 255;
}

interface CloseEventController {
  event: Event<number>;
  fire(code: number): void;
}

export function createCloseEventController(): CloseEventController {
  const emitter = new Emitter<number>();
  let closed = false;
  let closeCode = 0;

  const event: Event<number> = (listener) => {
    // 远端命令可能在调用方订阅 onClose 之前就瞬间退出。
    // 如果事件只做“在线分发”不做补发，waitForClose 会永远等不到，表现为连接卡住。
    // 这里对晚订阅者补发最后一次 close code，避免竞态丢事件。
    if (closed) {
      queueMicrotask(() => {
        listener(closeCode);
      });
      return { dispose() {} };
    }

    return emitter.event(listener);
  };

  const fire = (code: number) => {
    if (closed) {
      return;
    }
    closed = true;
    closeCode = code;
    emitter.fire(code);
    emitter.dispose();
  };

  return { event, fire };
}
