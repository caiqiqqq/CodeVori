// Actual Chromium PAC resolution and isolated Session policy; no external requests.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "zcode-domain-pac-"));
try {
  const entry = join(directory, "entry.mjs"),
    bundle = join(directory, "bundle.mjs");
  await writeFile(
    entry,
    `
    import assert from 'node:assert/strict';
    import {runInNewContext} from 'node:vm';
    import {app,session} from 'electron';
    import {applyDesktopChromiumNetworkPolicies, applyDesktopBrowserSessionNetworkPolicy, buildSelectiveProxyPac} from ${JSON.stringify(new URL("../src/main/desktopNetworkPolicy.ts", import.meta.url).pathname)};
    app.setPath('userData',${JSON.stringify(directory)});
    const deadline=setTimeout(()=>app.exit(1),20000);
    app.whenReady().then(async()=>{
      const warnings=[]; const logger={info(){},warn(...args){warnings.push(args)}};
      const settings={httpProxy:'http://127.0.0.1:17890',httpProxyOnlyDomains:'github.com,*.example.com',httpProxyNoProxy:'private.example.com,port.example.com:443',embeddedBrowserAllowInsecureCertificates:true};
      await applyDesktopChromiumNetworkPolicies(session,settings,logger);
      assert.deepEqual(warnings,[]);
      const isolated=session.fromPartition('synthetic-isolated-login');
      let applied=0,verify;
      const original=isolated.setProxy.bind(isolated);
      isolated.setProxy=(config)=>{applied++;return original(config)};
      isolated.setCertificateVerifyProc=(proc)=>{verify=proc};
      await Promise.all([applyDesktopBrowserSessionNetworkPolicy(isolated),applyDesktopBrowserSessionNetworkPolicy(isolated)]);
      assert.equal(applied,1,'Concurrent uploads share the same Session configuration');
      assert.equal(verify,null,'Native authentication must not inherit insecure browser TLS');
      const cases=[['https://github.com','PROXY 127.0.0.1:17890'],['https://github.com.evil.test','DIRECT'],['https://api.example.com','PROXY 127.0.0.1:17890'],['https://example.com','DIRECT'],['https://private.example.com','DIRECT'],['https://port.example.com','DIRECT'],['http://port.example.com','PROXY 127.0.0.1:17890'],['https://unmatched.test','DIRECT']];
      const pac=runInNewContext(buildSelectiveProxyPac(settings.httpProxyOnlyDomains,settings.httpProxyNoProxy,'PROXY 127.0.0.1:17890')+';FindProxyForURL');
      for(const [url,expected]of cases){assert.equal(pac(url,new URL(url).hostname),expected,'PAC source '+url);assert.equal(await isolated.resolveProxy(url),expected,'Actual Chromium '+url);assert.equal(await session.defaultSession.resolveProxy(url),expected,'Default Session '+url)}
      await isolated.cookies.set({url:'https://github.com',name:'synthetic',value:'kept'});
      await applyDesktopBrowserSessionNetworkPolicy(isolated);
      assert.equal((await isolated.cookies.get({name:'synthetic'})).length,1,'Network configuration does not copy or clear cookies');
      clearTimeout(deadline);console.log('Selective proxy Electron tests passed');app.exit(0);
    }).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});
  `,
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    target: "node24",
  });
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.env.ZCODE_ELECTRON_TEST_BINARY ?? require("electron"), [bundle], {
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Selective proxy Electron test exited ${code}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
