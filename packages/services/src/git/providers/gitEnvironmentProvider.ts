import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, extname, resolve as resolvePath } from "node:path";
import {
  DEFAULT_GIT_DISCOVERY_TIMEOUT_MS,
  getGitBinaryCandidates,
  getGitCommandEnv,
} from "../config.js";

export interface GitEnvironmentProvider {
  resolveGitBinary(): Promise<string | null>;
  createCommandEnv(): NodeJS.ProcessEnv;
}

async function resolveGitCandidate(
  candidate: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const windows = process.platform === "win32";
  const pathKey = windows
    ? Object.keys(env)
        .sort()
        .find((key) => key.toLowerCase() === "path")
    : "PATH";
  const pathValue = (pathKey ? env[pathKey] : undefined) ?? (windows ? "" : "/usr/bin:/bin");
  const directories = pathValue.split(delimiter);
  if (windows) directories.unshift(process.cwd());
  const extensions = windows && !extname(candidate) ? [".com", ".exe"] : [""];
  const paths =
    candidate.includes("/") || (windows && candidate.includes("\\"))
      ? extensions.map((extension) => resolvePath(`${candidate}${extension}`))
      : directories.flatMap((directory) =>
          extensions.map((extension) =>
            resolvePath(
              windows ? directory.replace(/^"|"$/g, "") : directory,
              `${candidate}${extension}`,
            ),
          ),
        );
  for (const path of paths) {
    try {
      if (!(await stat(path)).isFile()) continue;
      await access(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}

async function canExecuteGitCandidate(candidate: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(candidate, ["--version"], {
      env,
      stdio: "ignore",
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, DEFAULT_GIT_DISCOVERY_TIMEOUT_MS);

    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export function createGitEnvironmentProvider(): GitEnvironmentProvider {
  let cachedGitBinaryPromise: Promise<string | null> | null = null;

  return {
    async resolveGitBinary(): Promise<string | null> {
      if (cachedGitBinaryPromise) {
        return await cachedGitBinaryPromise;
      }

      const env = getGitCommandEnv();
      // Git binary 的探测在一次会话里不会频繁变化，
      // 这里缓存第一次探测结果，避免每个 Git RPC 都重复打一遍 `git --version`。
      cachedGitBinaryPromise = (async () => {
        for (const candidate of getGitBinaryCandidates()) {
          // 只验证命令名会把 "git" 显示成安装路径；解析并执行同一绝对路径，避免显示与实际命令不一致。
          const binaryPath = await resolveGitCandidate(candidate, env);
          if (binaryPath && (await canExecuteGitCandidate(binaryPath, env))) {
            return binaryPath;
          }
        }
        return null;
      })();

      return await cachedGitBinaryPromise;
    },

    createCommandEnv(): NodeJS.ProcessEnv {
      return getGitCommandEnv();
    },
  };
}
