import type { CredentialVaultSshCommandExecutor } from "@zcode/services/node";
import type { StdioStream } from "./backend.js";
import { SSHBackend } from "./ssh-backend.js";
import { normalizeSSHConnectError } from "./sshAuth.js";

type CredentialedSshInput = Parameters<CredentialVaultSshCommandExecutor>[0];
type CredentialedSshResult = Awaited<ReturnType<CredentialVaultSshCommandExecutor>>;

interface CredentialedSshBackend {
  exec(command: string): Promise<StdioStream>;
  dispose(): void;
}

export interface CredentialedSshCommandDependencies {
  createBackend?: (input: CredentialedSshInput) => CredentialedSshBackend;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

function collectCommandResult(
  stream: StdioStream,
  backend: CredentialedSshBackend,
  maxBytes: number,
  timeoutMs: number,
): Promise<CredentialedSshResult> {
  return new Promise((resolve, reject) => {
    let stdoutEnded = false;
    let stderrEnded = false;
    let closed = false;
    let exitCode = 0;
    let outputTruncated = false;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      closeSubscription.dispose();
      stream.stdout.removeListener("data", onStdoutData);
      stream.stdout.removeListener("end", onStdoutEnd);
      stream.stdout.removeListener("error", onError);
      stream.stderr.removeListener("data", onStderrData);
      stream.stderr.removeListener("end", onStderrEnd);
      stream.stderr.removeListener("error", onError);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = () => {
      if (settled || !closed || !stdoutEnded || !stderrEnded) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        ...(outputTruncated ? { outputTruncated: true } : {}),
      });
    };
    const append = (chunks: Buffer[], chunk: Buffer | string, currentSize: number) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - currentSize;
      if (remaining <= 0) {
        outputTruncated = outputTruncated || bytes.byteLength > 0;
        return currentSize;
      }
      const visible = bytes.subarray(0, remaining);
      chunks.push(visible);
      if (visible.byteLength < bytes.byteLength) outputTruncated = true;
      return currentSize + visible.byteLength;
    };
    const onStdoutData = (chunk: Buffer | string) => {
      stdoutBytes = append(stdoutChunks, chunk, stdoutBytes);
    };
    const onStderrData = (chunk: Buffer | string) => {
      stderrBytes = append(stderrChunks, chunk, stderrBytes);
    };
    const onStdoutEnd = () => {
      stdoutEnded = true;
      finish();
    };
    const onStderrEnd = () => {
      stderrEnded = true;
      finish();
    };
    const onError = (error: Error) =>
      fail(new Error("SSH command stream failed", { cause: error }));
    const closeSubscription = stream.onClose((code) => {
      closed = true;
      exitCode = code;
      finish();
    });
    const timer = setTimeout(() => {
      backend.dispose();
      fail(new Error("SSH command timed out"));
    }, timeoutMs);
    timer.unref?.();
    stream.stdout.on("data", onStdoutData);
    stream.stdout.once("end", onStdoutEnd);
    stream.stdout.on("error", onError);
    stream.stderr.on("data", onStderrData);
    stream.stderr.once("end", onStderrEnd);
    stream.stderr.on("error", onError);
    try {
      stream.stdin.end();
    } catch (error) {
      fail(error instanceof Error ? error : new Error("SSH command input failed"));
    }
  });
}

export async function runCredentialedSshCommand(
  input: CredentialedSshInput,
  dependencies: CredentialedSshCommandDependencies = {},
): Promise<CredentialedSshResult> {
  const backend =
    dependencies.createBackend?.(input) ??
    new SSHBackend({
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
    });
  try {
    const stream = await backend.exec(input.command);
    return await collectCommandResult(
      stream,
      backend,
      Math.max(0, dependencies.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES),
      Math.max(1, dependencies.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS),
    );
  } catch (error) {
    throw normalizeSSHConnectError(error);
  } finally {
    backend.dispose();
  }
}
