import { buildAgentRuntimeEnv } from "../runtime-tools/agentProxyEnv.js";

/** 安装链上的 npm/git/uv 读取不同大小写的标准变量，显式 Host 设置必须覆盖继承值。 */
export function buildAcpInstallNetworkEnv(options: {
  httpProxy?: string;
  noProxy?: string;
  caCertPath?: string;
}): Record<string, string> {
  const patch = buildAgentRuntimeEnv({ ...options, httpProxy: options.httpProxy });
  const proxy = patch.HTTP_PROXY ?? "";
  const noProxy = patch.NO_PROXY ?? "";
  const ca = options.caCertPath?.trim() ?? "";
  return {
    // Hermes 的 uv 引导使用原生 fetch；只有标准变量而未启用此开关时，Node 仍可能直连。
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    all_proxy: proxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    npm_config_proxy: proxy,
    npm_config_https_proxy: proxy,
    npm_config_noproxy: noProxy,
    ...(ca
      ? {
          NODE_EXTRA_CA_CERTS: ca,
          SSL_CERT_FILE: ca,
          REQUESTS_CA_BUNDLE: ca,
          CURL_CA_BUNDLE: ca,
          GIT_SSL_CAINFO: ca,
          npm_config_cafile: ca,
        }
      : {}),
    ...patch,
  };
}

export function mergeAcpInstallNetworkEnv(
  base: NodeJS.ProcessEnv,
  patch: Record<string, string>,
): NodeJS.ProcessEnv {
  const result = { ...base };
  const keys =
    /^(?:(?:http|https|all|no)_proxy|zcode_(?:http_proxy|no_proxy|agent_ca_cert)|node_extra_ca_certs|ssl_cert_(?:file|dir)|requests_ca_bundle|curl_ca_bundle|git_ssl_cainfo|npm_config_(?:proxy|https_proxy|noproxy|cafile|ca))$/i;
  for (const key of Object.keys(result)) if (keys.test(key)) delete result[key];
  return { ...result, ...patch };
}
