import {
  matchesProxyOnlyDomains,
  normalizeProxyOnlyDomains,
  matchesProxyBypass,
  parseProxyBypassRules,
} from "@zcode/shared";
import { createSubprocessProxyRouter } from "./subprocessProxyRouter.js";
import { readFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import { Agent, ProxyAgent, fetch as undiciFetch, Dispatcher } from "undici";

export interface HostApiNetworkOptions {
  httpProxy?: string;
  noProxy?: string;
  onlyDomains?: string;
  caCertPath?: string;
}

export interface HostApiNetworkTransport {
  fetch: typeof fetch;
  getSubprocessProxyUrl(options: HostApiNetworkOptions): Promise<string | undefined>;
  dispose(): void;
  disposeAndWait(): Promise<void>;
}

type HostProxyRoute =
  | { kind: "direct"; noProxyMatched?: boolean }
  | { kind: "proxy"; proxyUrl: string }
  | { kind: "invalid"; reason: string };

function mergeHostApiCaCertificates(
  customCa: string,
  defaultCa: readonly string[] = rootCertificates,
): string[] {
  // Node 的 tls.ca 会替换而不是追加默认根证书。只传企业代理 CA 会让未被
  // 中间人重签的公网证书失去信任链，因此必须同时保留 Node 默认根证书。
  return [...defaultCa, customCa];
}

function normalizeProxyUrl(value: string): string | undefined {
  const candidate = /^\w[\w+.-]*:\/\//.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname || !["http:", "https:"].includes(url.protocol)) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function resolveHostProxyForUrl(
  requestUrl: string | URL,
  options: HostApiNetworkOptions,
): HostProxyRoute {
  let url: URL;
  try {
    url = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  } catch {
    return { kind: "direct" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "direct" };
  }
  if (matchesProxyBypass(url, parseProxyBypassRules(options.noProxy))) {
    return { kind: "direct", noProxyMatched: true };
  }
  if (!matchesProxyOnlyDomains(url.hostname, options.onlyDomains)) return { kind: "direct" };
  const configuredProxy = options.httpProxy?.trim();
  if (!configuredProxy) {
    return { kind: "direct" };
  }
  const proxyUrl = normalizeProxyUrl(configuredProxy);
  return proxyUrl
    ? { kind: "proxy", proxyUrl }
    : { kind: "invalid", reason: "Configured Host proxy URL is invalid" };
}

class SelectiveProxyDispatcher extends Dispatcher {
  constructor(private readonly select: (url: URL) => Promise<Dispatcher>) {
    super();
  }
  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean {
    void this.select(new URL(options.path, String(options.origin))).then(
      (target) => {
        try {
          target.dispatch(options, handler);
        } catch (error) {
          handler.onError?.(error instanceof Error ? error : new Error("Proxy dispatch failed"));
        }
      },
      (error: unknown) =>
        handler.onError?.(error instanceof Error ? error : new Error("Proxy selection failed")),
    );
    return true;
  }
}

interface HostApiNetworkTransportDependencies {
  createDispatcher?: typeof createDispatcher;
  fetchWithDispatcher?: (
    input: string,
    init: Omit<RequestInit, "dispatcher"> & { dispatcher: Dispatcher },
  ) => Promise<Response>;
}

export function createHostApiNetworkTransport(
  resolveOptions: () => Promise<HostApiNetworkOptions>,
  dependencies: HostApiNetworkTransportDependencies = {},
): HostApiNetworkTransport {
  // Host 是独立 Node 进程，Electron Session.setProxy 不会影响它的 globalThis.fetch；
  // 在 NodeApiClient 出口按请求注入 dispatcher，避免把 telemetry 等其它裸 fetch 全局改道。
  let optionsPromise: Promise<HostApiNetworkOptions> | undefined;
  const dispatcherPromises = new Map<string, Promise<Dispatcher>>();
  let disposed = false;
  let generation = 0;
  let pendingDispatcherCreations = 0;
  let resolveDispatcherCreations: (() => void) | undefined;
  let dispatcherCreationsDone: Promise<void> | undefined;
  const lateDisposePromises: Promise<void>[] = [];
  let disposePromise: Promise<void> | undefined;
  let disposeMode: "close" | "destroy" | undefined;
  const dispatcherFactory = dependencies.createDispatcher ?? createDispatcher;
  const fetchWithDispatcher =
    dependencies.fetchWithDispatcher ??
    ((input, init) => undiciFetch(input, init as never) as unknown as Promise<Response>);

  const subprocessRouters = new Map<
    string,
    Promise<Awaited<ReturnType<typeof createSubprocessProxyRouter>>>
  >();
  const getSubprocessProxyUrl = async (
    options: HostApiNetworkOptions,
  ): Promise<string | undefined> => {
    if (disposed) throw new Error("Host API network transport has been disposed");
    if (!options.httpProxy?.trim()) return undefined;
    const onlyDomains = normalizeProxyOnlyDomains(options.onlyDomains);
    if (!onlyDomains) return options.httpProxy;
    const proxyUrl = normalizeProxyUrl(options.httpProxy);
    if (!proxyUrl) throw new Error("Configured Host proxy URL is invalid");
    const policy = { ...options, onlyDomains };
    const key = JSON.stringify(policy);
    let pending = subprocessRouters.get(key);
    if (!pending) {
      if (subprocessRouters.size >= 32)
        throw new Error(
          "Too many Agent network policies; restart the Host to release old policies",
        );
      pending = createSubprocessProxyRouter({
        proxyUrl,
        caCertPath: options.caCertPath,
        shouldProxy: (url) => resolveHostProxyForUrl(url, policy).kind === "proxy",
      });
      subprocessRouters.set(key, pending);
      void pending.catch(() => {
        if (subprocessRouters.get(key) === pending) subprocessRouters.delete(key);
      });
    }
    const router = await pending;
    if (disposed) {
      await router.dispose();
      throw new Error("Host API network transport has been disposed");
    }
    return router.url;
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (disposed) {
      throw new Error("Host API network transport has been disposed");
    }
    const requestGeneration = generation;
    if (!optionsPromise) {
      // 设置读取失败只影响当前请求；清掉 rejected promise，避免一次瞬时 IPC/启动竞态
      // 把 Host API 永久锁死，同时仍保持失败请求不回退到直连。
      optionsPromise = resolveOptions().catch((error: unknown) => {
        optionsPromise = undefined;
        throw error;
      });
    }
    const options = await optionsPromise;
    if (disposed || generation !== requestGeneration) {
      throw new Error("Host API network transport has been disposed");
    }
    const getDispatcherForUrl = async (url: string | URL): Promise<Dispatcher> => {
      if (disposed) throw new Error("Host API network transport has been disposed");
      const route = resolveHostProxyForUrl(url, options);
      if (route.kind === "invalid") throw new Error(route.reason);
      const dispatcherKey = `${route.kind}:${route.kind === "proxy" ? route.proxyUrl : "direct"}:${options.caCertPath ?? ""}`;
      let dispatcherPromise = dispatcherPromises.get(dispatcherKey);
      if (!dispatcherPromise) {
        if (disposed) {
          throw new Error("Host API network transport has been disposed");
        }
        const dispatcherGeneration = generation;
        pendingDispatcherCreations += 1;
        dispatcherPromise = dispatcherFactory(route, options.caCertPath);
        dispatcherPromises.set(dispatcherKey, dispatcherPromise);
        void dispatcherPromise
          .then((dispatcher) => {
            if (
              (disposed || generation !== dispatcherGeneration) &&
              dispatcherPromises.get(dispatcherKey) === dispatcherPromise
            ) {
              dispatcherPromises.delete(dispatcherKey);
              const cleanupPromise = Promise.resolve(
                disposeMode === "close" ? dispatcher.close() : dispatcher.destroy(),
              ).catch(() => {});
              lateDisposePromises.push(cleanupPromise);
            }
          })
          .catch(() => {});
        const markDispatcherCreationDone = () => {
          pendingDispatcherCreations -= 1;
          if (pendingDispatcherCreations === 0) {
            resolveDispatcherCreations?.();
            resolveDispatcherCreations = undefined;
          }
        };
        void dispatcherPromise.then(markDispatcherCreationDone, markDispatcherCreationDone);
        dispatcherPromise.catch(() => {
          // 设置/CA 等临时 IO 失败只影响当前请求；清理 rejected dispatcher，避免一次启动竞态
          // 把同一路由永久锁死，同时仍保持失败请求 fail-closed、不回退到直连。
          if (dispatcherPromises.get(dispatcherKey) === dispatcherPromise) {
            dispatcherPromises.delete(dispatcherKey);
          }
        });
      }
      const dispatcher = await dispatcherPromise;
      if (disposed || generation !== requestGeneration) {
        throw new Error("Host API network transport has been disposed");
      }
      return dispatcher;
    };
    const requestUrl = input instanceof Request ? input.url : String(input);
    const route = resolveHostProxyForUrl(requestUrl, options);
    if (route.kind === "invalid") throw new Error(route.reason);
    const selective = Boolean(
      options.httpProxy?.trim() && normalizeProxyOnlyDomains(options.onlyDomains),
    );
    if (!selective && route.kind === "direct" && !options.caCertPath) {
      return globalThis.fetch(input, init);
    }
    // 重定向可能切换域名；dispatcher 每跳重新选择出口，不能把首个域名的代理沿用到整个链路。
    const dispatcher = selective
      ? new SelectiveProxyDispatcher(getDispatcherForUrl)
      : await getDispatcherForUrl(requestUrl);
    const requestInit =
      input instanceof Request
        ? {
            method: input.method,
            headers: input.headers,
            body: input.body,
            redirect: input.redirect,
            signal: input.signal,
            credentials: input.credentials,
            ...(input.body ? { duplex: "half" } : {}),
          }
        : {};
    return fetchWithDispatcher(requestUrl, { ...requestInit, ...init, dispatcher } as Omit<
      RequestInit,
      "dispatcher"
    > & { dispatcher: Dispatcher });
  };

  const startDispose = (mode: "close" | "destroy"): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    generation += 1;
    disposeMode = mode;
    // dispatcher 不能只被闭包缓存、没有 Host owner：窗口/远端 Host 重建后连接池和
    // keep-alive socket 仍可能存活。释放时对当前单飞 Promise 做快照，确保初始化中的 dispatcher
    // 也会在完成后被收口；同步退出 destroy，等待式退出 close。
    const pendingRouters = [...subprocessRouters.values()];
    subprocessRouters.clear();
    const pendingDispatchers = [...dispatcherPromises.values()];
    dispatcherPromises.clear();
    if (pendingDispatcherCreations > 0) {
      dispatcherCreationsDone = new Promise<void>((resolve) => {
        resolveDispatcherCreations = resolve;
      });
    }
    disposePromise = (async () => {
      await Promise.allSettled([
        ...pendingRouters.map(async (pending) => (await pending).dispose()),
        ...pendingDispatchers.map(async (dispatcherPromise) => {
          const dispatcher = await dispatcherPromise;
          if (mode === "close") {
            await dispatcher.close();
          } else {
            await dispatcher.destroy();
          }
        }),
      ]);
      await dispatcherCreationsDone;
      await Promise.all(lateDisposePromises);
    })();
    return disposePromise;
  };

  return {
    fetch,
    getSubprocessProxyUrl,
    dispose() {
      void startDispose("destroy");
    },
    disposeAndWait() {
      return startDispose("close");
    },
  };
}

async function createDispatcher(
  route: Exclude<HostProxyRoute, { kind: "invalid" }>,
  caCertPath: string | undefined,
): Promise<Dispatcher> {
  const customCa = caCertPath ? await readFile(caCertPath, "utf8") : undefined;
  const ca = customCa ? mergeHostApiCaCertificates(customCa) : undefined;
  if (route.kind === "proxy") {
    return new ProxyAgent({
      uri: route.proxyUrl,
      proxyTls: ca ? { ca } : undefined,
      requestTls: ca ? { ca } : undefined,
    });
  }
  return new Agent({ connect: ca ? { ca } : undefined });
}
