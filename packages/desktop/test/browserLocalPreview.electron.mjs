// 使用隔离 Electron 进程验证真实文件 loader 与预览授权，不读取用户文件。
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "zcode-preview-security-"));
const bundle = join(directory, "test.mjs");
try {
  const source = `
    import assert from 'node:assert/strict';
    import {app,net,protocol,session} from 'electron';
    import {mkdir,writeFile,symlink} from 'node:fs/promises';
    import {join} from 'node:path';
    import {pathToFileURL} from 'node:url';
    import {createBrowserLocalPreview,installBrowserLocalPreview,BROWSER_LOCAL_PREVIEW_PRIVILEGES} from ${JSON.stringify(new URL("../src/main/browser-local-preview/index.ts", import.meta.url).pathname)};
    const root=${JSON.stringify(directory)};
    app.setPath('userData',join(root,'profile'));
    protocol.registerSchemesAsPrivileged([BROWSER_LOCAL_PREVIEW_PRIVILEGES]);
    const deadline=setTimeout(()=>app.exit(1),20000);
    app.whenReady().then(async()=>{
      const dir=join(root,'site');await mkdir(dir);
      await writeFile(join(dir,'index.html'),'<!doctype html><h1>preview</h1>');
      await writeFile(join(dir,'asset.css'),'body { color: red; }');
      await writeFile(join(dir,'.secret'),'private');
      await writeFile(join(root,'outside.txt'),'outside');
      await symlink(join(root,'outside.txt'),join(dir,'escape.txt'));
      const preview=createBrowserLocalPreview();
      const input=pathToFileURL(join(dir,'index.html')).href+'?test=1#section';
      const url=await preview.resolveNavigation(input);
      assert.equal(new URL(url).search,'?test=1');assert.equal(new URL(url).hash,'#section');
      const response=await preview.respond(new Request(url));
      assert.equal(response.status,200);assert.match(await response.text(),/preview/);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
      assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
      const sibling=name=>new URL(name,url).href;
      assert.equal((await preview.respond(new Request(sibling('asset.css')))).status,200);
      for(const name of ['.secret','%2esecret','%2foutside.txt','escape.txt']) {
        assert.equal((await preview.respond(new Request(sibling(name)))).status,403,name);
      }
      const forged=new URL(url);forged.hostname='0'.repeat(64);
      assert.equal((await preview.respond(new Request(forged))).status,403);
      assert.equal((await createBrowserLocalPreview().respond(new Request(url))).status,403);
      assert.equal((await preview.respond(new Request(url,{method:'POST'}))).status,405);
      await assert.rejects(preview.resolveNavigation(pathToFileURL(join(dir,'asset.css')).href),/HTML/);
      assert.equal(await preview.resolveNavigation('https://example.test'),'https://example.test');
      installBrowserLocalPreview(session.defaultSession);
      await assert.rejects(net.fetch(pathToFileURL(join(dir,'index.html')).href));
      console.log('Browser local preview: allowed HTML/assets; denied raw file, hidden paths, traversal, symlink escape, forged/old signatures and writes; Electron '+process.versions.electron);
      clearTimeout(deadline);app.exit(0);
    }).catch(error=>{console.error(error);app.exit(1)});
  `;
  await build({
    stdin: {
      contents: source,
      resolveDir: process.cwd(),
      sourcefile: "browser-preview-security-test.mjs",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    outfile: bundle,
    tsconfig: new URL("../tsconfig.main.json", import.meta.url).pathname,
  });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.env.ZCODE_ELECTRON_TEST_BINARY ?? require("electron"), [bundle], {
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal });
    });
  });
  if (result.code !== 0) throw new Error(`Preview security test failed: ${JSON.stringify(result)}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
