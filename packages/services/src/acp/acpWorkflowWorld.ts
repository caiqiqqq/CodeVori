import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { glob, readFile, stat, writeFile, mkdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  WORLD_READ_CAPS,
  WorkflowError,
  type ArtifactPublishRequest,
  type ArtifactVersionRecord,
  type WorldReadOp,
} from "@zcode/dynamic-workflow";

const within = (root: string, path: string): string => {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (isAbsolute(path) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new WorkflowError("DriverError", "Workflow path leaves the workspace");
  return absolute;
};
async function safeExisting(root: string, path: string): Promise<string> {
  const target = within(root, path);
  const actual = await realpath(target);
  const parent = await realpath(root);
  const rel = relative(parent, actual);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new WorkflowError("DriverError", "Workflow symlink leaves the workspace");
  return actual;
}

/** Journal 的已完成产物元数据是唯一可用的寻址输入，文件名不直接使用模型给出的 id。 */
export function acpWorkflowArtifactPath(
  cwd: string,
  runId: string,
  record: Pick<ArtifactVersionRecord, "id" | "kind" | "version" | "sourcePath">,
): string {
  const stem = createHash("sha256").update(record.id).digest("hex");
  const extension = record.kind === "markdown" ? ".md" : extname(record.sourcePath ?? "");
  return within(
    cwd,
    join(".zcode", "workflow-runs", runId, "artifacts", `${stem}-${record.version}${extension}`),
  );
}

export async function resolveAcpWorkflowArtifact(
  cwd: string,
  runId: string,
  record: Pick<ArtifactVersionRecord, "id" | "kind" | "version" | "sourcePath">,
): Promise<string> {
  const path = acpWorkflowArtifactPath(cwd, runId, record);
  const actual = await safeExisting(cwd, relative(cwd, path));
  if (!(await stat(actual)).isFile())
    throw new WorkflowError("DriverError", "Workflow artifact is not a file");
  return actual;
}

function command(cmd: string, args: string[], cwd: string, timeoutMs: number, signal: AbortSignal) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false, signal, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) > WORLD_READ_CAPS.runStdoutMaxBytes) child.kill();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stderr) > WORLD_READ_CAPS.runStderrMaxBytes) child.kill();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        reject(new WorkflowError("DriverError", `Workflow command timed out after ${timeoutMs}ms`));
      else if (signal.aborted) reject(new WorkflowError("DriverError", "Workflow stopped"));
      else if (
        Buffer.byteLength(stdout) > WORLD_READ_CAPS.runStdoutMaxBytes ||
        Buffer.byteLength(stderr) > WORLD_READ_CAPS.runStderrMaxBytes
      )
        reject(new WorkflowError("WorldReadCapExceeded", "Workflow command output exceeded 256KB"));
      else done({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

export function createAcpWorkflowWorld(input: {
  cwd: string;
  runId: string;
  commands: ReadonlySet<string>;
  signal: AbortSignal;
}) {
  const { cwd, runId, commands, signal } = input;
  const git = async (args: string[]) => {
    const result = await command("git", args, cwd, 30_000, signal);
    if (result.exitCode !== 0)
      throw new WorkflowError("DriverError", result.stderr || "Git command failed");
    return result.stdout;
  };
  const ref = (value: unknown) => {
    if (value === undefined) return "HEAD";
    if (
      typeof value !== "string" ||
      !/^[\w./^~-]+$/.test(value) ||
      value.startsWith("-") ||
      value.includes("..")
    )
      throw new WorkflowError("DriverError", "Invalid git base ref");
    return value;
  };
  return {
    async read(op: WorldReadOp, args: unknown[]): Promise<unknown> {
      if (signal.aborted) throw new WorkflowError("DriverError", "Workflow stopped");
      switch (op) {
        case "run": {
          const [cmd, argv = [], options = {}] = args;
          if (
            typeof cmd !== "string" ||
            !commands.has(cmd) ||
            !Array.isArray(argv) ||
            !argv.every((part) => typeof part === "string")
          )
            throw new WorkflowError("DriverError", "Workflow command was not approved");
          const timeoutMs =
            typeof options === "object" &&
            options &&
            "timeoutMs" in options &&
            typeof options.timeoutMs === "number"
              ? options.timeoutMs
              : WORLD_READ_CAPS.runDefaultTimeoutMs;
          return command(cmd, argv as string[], cwd, timeoutMs, signal);
        }
        case "read": {
          if (args.length !== 1 || typeof args[0] !== "string")
            throw new WorkflowError("DriverError", "Invalid files.read path");
          const path = await safeExisting(cwd, args[0]);
          if ((await stat(path)).size > 1024 * 1024)
            throw new WorkflowError("WorldReadCapExceeded", "Workflow file exceeds 1MB");
          return readFile(path, "utf8");
        }
        case "glob": {
          if (args.length !== 1 || typeof args[0] !== "string")
            throw new WorkflowError("DriverError", "Invalid glob pattern");
          const matches: string[] = [];
          for await (const path of glob(args[0], { cwd })) {
            if ((await stat(await safeExisting(cwd, path))).isFile()) matches.push(path);
            if (matches.length > WORLD_READ_CAPS.globMaxFiles)
              throw new WorkflowError("WorldReadCapExceeded", "Too many files");
          }
          return matches.sort();
        }
        case "grep": {
          if (typeof args[0] !== "string")
            throw new WorkflowError("DriverError", "Invalid grep pattern");
          const grepArgs = ["--json", "--", args[0], "."];
          if (args[1] !== undefined) {
            if (typeof args[1] !== "string")
              throw new WorkflowError("DriverError", "Invalid grep glob");
            grepArgs.unshift("--glob", args[1]);
          }
          const result = await command("rg", grepArgs, cwd, 30_000, signal);
          if (result.exitCode > 1)
            throw new WorkflowError("DriverError", result.stderr || "ripgrep failed");
          const matches = result.stdout
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => {
              const event = JSON.parse(line) as {
                type: string;
                data?: {
                  path?: { text?: string };
                  line_number?: number;
                  lines?: { text?: string };
                };
              };
              if (event.type !== "match" || !event.data?.path?.text || !event.data.line_number)
                return [];
              return [
                {
                  path: event.data.path.text,
                  line: event.data.line_number,
                  text: event.data.lines?.text?.replace(/\n$/, "") ?? "",
                },
              ];
            });
          if (
            matches.length > WORLD_READ_CAPS.grepMaxMatches ||
            Buffer.byteLength(JSON.stringify(matches)) > WORLD_READ_CAPS.grepMaxSerializedBytes
          )
            throw new WorkflowError("WorldReadCapExceeded", "Too many grep matches");
          return matches;
        }
        case "git-status": {
          if (args.length) throw new WorkflowError("DriverError", "git.status takes no arguments");
          const output = await git([
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=all",
            "--",
            ".",
          ]);
          const [head, ...changes] = output.split("\n").filter(Boolean);
          const staged: string[] = [],
            unstaged: string[] = [],
            untracked: string[] = [];
          for (const line of changes) {
            const path = line.slice(3);
            if (line.startsWith("??")) untracked.push(path);
            else {
              if (line[0] !== " ") staged.push(path);
              if (line[1] !== " ") unstaged.push(path);
            }
          }
          return {
            ...(head?.startsWith("## ") && !head.includes("HEAD (no branch)")
              ? { branch: head.slice(3).split("...")[0] }
              : {}),
            clean: !changes.length,
            staged,
            unstaged,
            untracked,
          };
        }
        case "git-diff": {
          if (args.length > 2)
            throw new WorkflowError("DriverError", "git.diff takes up to two arguments");
          const path =
            args[1] === undefined
              ? "."
              : typeof args[1] === "string"
                ? relative(cwd, within(cwd, args[1])) || "."
                : "";
          if (!path) throw new WorkflowError("DriverError", "Invalid git.diff path");
          const output = await git(["diff", ref(args[0]), "--", path]);
          if (Buffer.byteLength(output) > WORLD_READ_CAPS.gitDiffMaxBytes)
            throw new WorkflowError("WorldReadCapExceeded", "Git diff exceeds 512KB");
          return output;
        }
        case "git-log": {
          const count = args[0] === undefined ? 20 : args[0];
          if (
            args.length > 1 ||
            typeof count !== "number" ||
            !Number.isInteger(count) ||
            count < 1 ||
            count > WORLD_READ_CAPS.gitLogMaxCount
          )
            throw new WorkflowError("DriverError", "Invalid git.log count");
          const output = await git(["log", `-n${count}`, "--format=%H%x00%s%x00%an%x00%aI"]);
          return output
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [hash, subject, author, date] = line.split("\0");
              return { hash, subject, author, date };
            });
        }
        case "git-changed-files": {
          if (args.length > 1)
            throw new WorkflowError("DriverError", "git.changedFiles takes one base");
          const output = await git(["diff", "--name-only", ref(args[0]), "--", "."]);
          const tracked = output.split("\n").filter(Boolean);
          if (args[0] !== undefined) return tracked;
          const untracked = (await git(["ls-files", "--others", "--exclude-standard", "--", "."]))
            .split("\n")
            .filter(Boolean);
          return [...new Set([...tracked, ...untracked])].sort();
        }
      }
    },
    async publish(request: ArtifactPublishRequest): Promise<ArtifactVersionRecord> {
      if (signal.aborted) throw new WorkflowError("DriverError", "Workflow stopped");
      const path = acpWorkflowArtifactPath(cwd, runId, {
        id: request.id,
        kind: request.op,
        version: request.version,
        ...(request.path ? { sourcePath: request.path } : {}),
      });
      const bytes =
        request.op === "file"
          ? await readFile(await safeExisting(cwd, request.path ?? ""))
          : Buffer.from(request.content ?? "", "utf8");
      if (bytes.length > 10 * 1024 * 1024)
        throw new WorkflowError("DriverError", "Workflow artifact exceeds 10MB");
      // 修复原因：.zcode 可能是软链接；逐级确认真实路径后再创建下一层，不能先递归写到外部。
      let dir = cwd;
      for (const segment of [".zcode", "workflow-runs", runId, "artifacts"]) {
        dir = join(dir, segment);
        await mkdir(dir).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
        await safeExisting(cwd, relative(cwd, dir));
      }
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      return {
        id: request.id,
        kind: request.op,
        version: request.version,
        bytes: bytes.length,
        uri: `zcode-artifact://${runId}/${encodeURIComponent(request.id)}/${request.version}`,
        contentType: request.op === "markdown" ? "text/markdown" : "application/octet-stream",
        ...(typeof request.opts === "object" &&
        request.opts &&
        "title" in request.opts &&
        typeof request.opts.title === "string"
          ? { title: request.opts.title }
          : {}),
        ...(request.path ? { sourcePath: request.path } : {}),
        publishedAt: Date.now(),
      };
    },
  };
}
