import { safeForgeUrl } from "./forgeApiClient.js";

export function gitlabWebUrl(
  value: unknown,
  repository: string,
  repositoryUrl?: string,
): string | null {
  const source = safeForgeUrl(value);
  const configured = safeForgeUrl(repositoryUrl);
  if (!source || !configured) return source;
  const url = new URL(source);
  const project = new URL(configured);
  const projectPath = project.pathname.replace(/\/$/, "");
  const repositoryPath = `/${repository.split("/").map(encodeURIComponent).join("/")}`;
  if (!projectPath.endsWith(repositoryPath)) return source;

  // 自建 GitLab 的 web_url 可能暴露内部地址；只按完整项目路径匹配，保留新版 work_items 等路由。
  const prefix = [projectPath, repositoryPath].find((path) =>
    url.pathname.startsWith(`${path}/-/`),
  );
  if (!prefix) return source;
  project.pathname = `${projectPath}${url.pathname.slice(prefix.length)}`;
  project.search = url.search;
  project.hash = url.hash;
  return project.href;
}
