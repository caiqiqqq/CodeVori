import { StringDecoder } from "node:string_decoder";
import { redactTelemetryText } from "@zcode/shared";

const MAX_LOG_LINE_CHARS = 32_768;

/** 先按完整行脱敏，再交付展示副本；不能按 chunk 脱敏后暴露跨 chunk 的凭据尾部。 */
export function createRemoteDiagnosticLines(emit: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let dropping = false;
  let finished = false;
  const flushLine = () => {
    const safe = dropping ? "[remote log line omitted: too long]" : redactTelemetryText(pending);
    pending = "";
    dropping = false;
    if (safe) emit(safe);
  };
  const consume = (text: string) => {
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf("\n", start);
      const end = newline < 0 ? text.length : newline;
      if (!dropping) {
        if (pending.length + end - start > MAX_LOG_LINE_CHARS) {
          pending = "";
          dropping = true;
        } else {
          pending += text.slice(start, end);
        }
      }
      if (newline < 0) break;
      flushLine();
      start = newline + 1;
    }
  };
  return {
    push(chunk: Buffer | string) {
      if (finished) return;
      consume(decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    },
    finish() {
      if (finished) return;
      finished = true;
      consume(decoder.end());
      flushLine();
    },
  };
}

export function forwardRemoteStderr(stream: NodeJS.ReadableStream, emit: (line: string) => void) {
  const lines = createRemoteDiagnosticLines(emit);
  const stop = () => {
    stream.removeListener("data", lines.push);
    stream.removeListener("end", stop);
    stream.removeListener("close", stop);
    lines.finish();
  };
  stream.on("data", lines.push);
  stream.on("end", stop);
  stream.on("close", stop);
  return stop;
}
