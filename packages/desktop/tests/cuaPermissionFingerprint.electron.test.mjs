import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const desktop = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(desktop, "package.json"));
const { build } = createRequire(requireDesktop.resolve("tsup/package.json"))("esbuild");
const { createPackage } = requireDesktop("@electron/asar");
const root = await mkdtemp(join(tmpdir(), "zcode-cua-fingerprint-"));

try {
  const archiveSource = join(root, "archive-source");
  const appPath = join(root, "Fixture.app");
  const resources = join(appPath, "Contents", "Resources");
  await mkdir(archiveSource);
  await mkdir(resources, { recursive: true });
  await mkdir(join(appPath, "Contents", "MacOS"));
  await mkdir(join(appPath, "Contents", "_CodeSignature"));
  await writeFile(join(archiveSource, "index.js"), "module.exports = 1;\n");
  await createPackage(archiveSource, join(resources, "app.asar"));
  await writeFile(join(resources, "asset.txt"), "fixture");
  await writeFile(join(appPath, "Contents", "MacOS", "Fixture"), "fixture");
  await writeFile(join(appPath, "Contents", "Info.plist"), "fixture");
  await writeFile(join(appPath, "Contents", "_CodeSignature", "CodeResources"), "fixture");

  const entry = join(root, "runner.mjs");
  await build({
    stdin: {
      resolveDir: desktop,
      sourcefile: "cua-permission-fingerprint-fixture.ts",
      contents: `
        import assert from 'node:assert/strict';
        import {statSync} from 'node:fs';
        import {promises as physicalFs} from 'original-fs';
        import {join} from 'node:path';
        import {app} from 'electron';
        import {openCuaPermissionOnboarding,prepareCuaHelperPermissionDrag,cuaHelperBundleFingerprintUnchanged} from './src/main/cuaAccessibilitySettings.ts';
        const {readFile,writeFile}=physicalFs;
        const root=process.argv[2];
        app.setPath('userData',join(root,'user-data'));
        const appPath=join(root,'Fixture.app');
        const identity={appPath,executablePath:join(appPath,'Contents','MacOS','Fixture'),bundleId:'test.cua.fixture',displayName:'Fixture'};
        const options={platform:'darwin',ensureHelperInstalled:async()=>appPath,verifyHelperInstalled:async()=>{},resolveHelperIdentity:async()=>identity};
        const results=[];
        async function check(name,operation){try{await operation();results.push({name,passed:true})}catch(error){results.push({name,passed:false,error:error.message})}}
        async function main(){
          // Electron 的 ASAR stat 没有真实 inode；此诊断只读取合成归档，不访问系统权限。
          const virtualPath=join(appPath,'Contents','Resources','app.asar','index.js');
          const a=statSync(virtualPath,{bigint:true}),b=statSync(virtualPath,{bigint:true});
          const virtualInodes={first:String(a.ino),second:String(b.ino)};
          await check('stable ASAR bundle can prepare permission drag',async()=>{
            const result=await prepareCuaHelperPermissionDrag(options);
            assert.equal(result.success,true,result.error);
            assert.ok(result.helperBundleFingerprint);
            assert.equal(cuaHelperBundleFingerprintUnchanged(appPath,result.helperBundleFingerprint),true);
          });
          await check('stable ASAR bundle can complete permission onboarding',async()=>{
            const opened=[];
            const result=await openCuaPermissionOnboarding({...options,requiredPermissions:['accessibility','screen_recording'],openSettingsUrl:async(url)=>{opened.push(url)},openSettingsAndWaitForReturn:async({openSettings})=>{await openSettings()}});
            assert.equal(result.success,true,result.error);
            assert.equal(result.returnedFromSettings,true);
            assert.equal(opened.length,2);
          });
          for(const relative of ['Resources/asset.txt','Resources/app.asar','MacOS/Fixture','Info.plist','_CodeSignature/CodeResources']){
            await check('actual mutation is rejected: '+relative,async()=>{
              const path=join(appPath,'Contents',relative);
              const bytes=await readFile(path);
              const prepared=await prepareCuaHelperPermissionDrag(options);
              assert.equal(prepared.success,true,prepared.error);
              let opened=0;
              try{
                const result=await openCuaPermissionOnboarding({...options,verifyHelperInstalled:async()=>{await writeFile(path,bytes)},openSettingsUrl:async()=>{opened++}});
                assert.equal(result.success,false);
                assert.match(result.error,/changed while its launch signature/);
                assert.equal(opened,0);
                assert.equal(cuaHelperBundleFingerprintUnchanged(appPath,prepared.helperBundleFingerprint),false);
                const drag=await prepareCuaHelperPermissionDrag({...options,verifyHelperInstalled:async()=>{await writeFile(path,bytes)}});
                assert.equal(drag.success,false);
                assert.match(drag.error,/changed while its drag signature/);
              }finally{await writeFile(path,bytes)}
            });
          }
          await check('identity change is rejected before opening settings',async()=>{
            let resolves=0,opened=0;
            const result=await openCuaPermissionOnboarding({...options,resolveHelperIdentity:async()=>++resolves===1?identity:{...identity,bundleId:'test.other'},openSettingsUrl:async()=>{opened++}});
            assert.equal(result.success,false);
            assert.match(result.error,/permission identity changed/);
            assert.equal(opened,0);
          });
          await check('post-settings mutation does not grant recovery',async()=>{
            const path=join(appPath,'Contents','Resources','asset.txt');
            const bytes=await readFile(path);
            let verifies=0;
            try{
              const result=await openCuaPermissionOnboarding({...options,verifyHelperInstalled:async()=>{if(++verifies===2)await writeFile(path,bytes)},openSettingsUrl:async()=>{},openSettingsAndWaitForReturn:async({openSettings})=>{await openSettings()}});
              assert.equal(result.success,false);
              assert.equal(result.returnedFromSettings,false);
              assert.match(result.error,/changed while its post-settings signature/);
            }finally{await writeFile(path,bytes)}
          });
          console.log('CUA_FINGERPRINT_RESULTS='+JSON.stringify({virtualInodes,results}));
          app.exit(results.some(result=>!result.passed)?1:0);
        }
        main().catch(error=>{console.error(error);app.exit(1)});
      `,
    },
    outfile: entry,
    bundle: true,
    format: "esm",
    platform: "node",
    external: ["electron", "original-fs"],
    plugins: [
      {
        name: "permission-test-boundaries",
        setup(build) {
          build.onResolve({ filter: /desktopCuaHelperInstaller\.js$/ }, () => ({
            path: "installer",
            namespace: "permission-test-boundaries",
          }));
          build.onResolve({ filter: /^@zcode\/services\/cua-permission-broker$/ }, () => ({
            path: "identity",
            namespace: "permission-test-boundaries",
          }));
          build.onLoad({ filter: /.*/, namespace: "permission-test-boundaries" }, ({ path }) => ({
            contents:
              path === "installer"
                ? "export function createDesktopCuaHelperInstaller(){throw new Error('Unexpected real Helper installer')}"
                : "export function resolveHelperPermissionSubjectIdentity(){throw new Error('Unexpected real Helper identity resolver')}",
          }));
        },
      },
    ],
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  let result;
  try {
    result = await promisify(execFile)(requireDesktop("electron"), [entry, root], {
      env,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    result = error;
  }
  const line = result.stdout
    ?.split("\n")
    .find((value) => value.startsWith("CUA_FINGERPRINT_RESULTS="));
  assert.ok(line, result.stderr ?? "Electron permission fixture did not report results");
  const { virtualInodes, results } = JSON.parse(line.slice("CUA_FINGERPRINT_RESULTS=".length));
  console.log(`Electron ASAR virtual inode diagnostic: ${JSON.stringify(virtualInodes)}`);
  for (const { name, passed, error } of results) {
    console.log(`${passed ? "PASS" : "FAIL"}: ${name}${error ? `: ${error}` : ""}`);
  }
  assert.equal(results.length, 9);
  assert.equal(results.filter((result) => !result.passed).length, 0);
} finally {
  await rm(root, { recursive: true, force: true });
}
