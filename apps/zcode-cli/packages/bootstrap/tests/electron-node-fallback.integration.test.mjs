import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

// 显式传真实 Electron 和随包 npm，默认 CI 不把普通 Node 冒充 Electron 运行结果。
test(
  "Electron currentRuntime discovers staged npm and starts MCP without system Node",
  {
    skip: !process.env.ZCODE_ELECTRON_TEST_BINARY || !process.env.ZCODE_TEST_BUNDLED_NPM_ROOT,
    timeout: 30_000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode electron no-node "));
    try {
      await mkdir(join(root, "node-runtime"));
      await cp(process.env.ZCODE_TEST_BUNDLED_NPM_ROOT, join(root, "node-runtime/npm"), {
        recursive: true,
      });
      const providerUrl = new URL("../src/app/mcp-node-fallback.ts", import.meta.url).href;
      const adapterUrl = new URL("../../adapters/src/mcp/index.ts", import.meta.url).href;
      // 依赖实际由 workspace 的 hoisted node_modules 提供；让 resolve 在 adapter 包下完成。
      const { createRequire } = await import("node:module");
      const require = createRequire(new URL("../../adapters/package.json", import.meta.url));
      const { pathToFileURL } = await import("node:url");
      const serverModule = pathToFileURL(require.resolve("@modelcontextprotocol/server")).href;
      const transportModule = pathToFileURL(
        require.resolve("@modelcontextprotocol/server/stdio"),
      ).href;
      const serverPath = join(root, "server.mjs");
      await writeFile(
        serverPath,
        `import {McpServer} from ${JSON.stringify(serverModule)};import {StdioServerTransport} from ${JSON.stringify(transportModule)};const server=new McpServer({name:'actual-electron',version:'1'});server.registerTool('ping',{inputSchema:{}},async()=>({content:[{type:'text',text:'pong'}]}));await server.connect(new StdioServerTransport());`,
      );
      const entry = join(root, "agent.mts");
      await writeFile(
        entry,
        `import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {resolveMcpNodeFallbackProvider} from ${JSON.stringify(providerUrl)};import {createMcpAdapter} from ${JSON.stringify(adapterUrl)};
const provider=resolveMcpNodeFallbackProvider({cliStorageRoot:${JSON.stringify(join(root, "storage"))}});assert.ok(process.versions.electron);assert.ok(provider);const fallback=await provider.resolve();assert.equal(fallback.env.ZCODE_NODE_FALLBACK_NPM_ROOT,${JSON.stringify(join(root, "node-runtime/npm"))});const env={PATH:process.env.PATH+':'+fallback.binDir,...fallback.env};for(const cmd of ['npm','npx'])assert.equal(execFileSync(cmd,['--version'],{env,encoding:'utf8'}).trim(),'11.6.0');const adapter=createMcpAdapter({env:{PATH:process.env.PATH},nodeFallback:provider});try{assert.equal((await adapter.connectServer('actual',{type:'stdio',command:'node',args:[${JSON.stringify(serverPath)}],timeoutMs:10000})).status,'connected');const result=await adapter.callTool({serverName:'actual',toolName:'ping',arguments:{}});assert.ok(JSON.stringify(result).includes('pong'));console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,npm:'11.6.0',mcp:'pong'}));}finally{await adapter.close();}`,
      );
      const { stdout } = await promisify(execFile)(
        process.env.ZCODE_ELECTRON_TEST_BINARY,
        ["--import", import.meta.resolve("tsx"), entry],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PATH: join(root, "empty-path") },
          timeout: 20_000,
        },
      );
      assert.match(stdout, /"mcp":"pong"/);
      console.log(stdout.trim());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
