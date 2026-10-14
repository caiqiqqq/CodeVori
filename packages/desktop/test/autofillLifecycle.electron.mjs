// Real Electron native popup/teardown, synthetic local HTML and isolated profile.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "zcode-autofill-lifecycle-"));
try {
  const entry = join(directory, "entry.cjs");
  const page = join(directory, "datalist.html");
  await writeFile(
    page,
    '<!doctype html><html><body><input type="text" list="suggestions"><datalist id="suggestions"><select><option value="John Mayer"></option><option value="Eric Clapton"></option><option value="Django Reinhardt"></option></select></datalist></body></html>',
  );
  await writeFile(
    entry,
    `
    const assert = require('node:assert/strict');
    const {setTimeout: delay} = require('node:timers/promises');
    const {app, BrowserWindow} = require('electron');
    app.setPath('userData', ${JSON.stringify(directory)});
    app.on('window-all-closed', () => {});
    const page = ${JSON.stringify(page)};
    const type = window => window.webContents.sendInputEvent({type:'char', keyCode:'E'});
    app.whenReady().then(async () => {
      const keeper = new BrowserWindow({show:false});
      const selection = new BrowserWindow({show:true});
      await selection.loadFile(page);
      selection.focus();
      selection.webContents.sendInputEvent({type:'keyDown', keyCode:'Tab'});
      for (const keyCode of 'clap') {
        selection.webContents.sendInputEvent({type:'char', keyCode});
        await delay(100);
      }
      selection.webContents.sendInputEvent({type:'keyDown', keyCode:'Down'});
      selection.webContents.sendInputEvent({type:'keyDown', keyCode:'Enter'});
      assert.equal(await selection.webContents.executeJavaScript('document.querySelector("input").value'), 'Eric Clapton');
      selection.destroy();
      // 自动填充消息来自 renderer，可能排在原生父视图销毁之后；用真实窗口反复覆盖这个生命周期。
      for (const mode of ['child-destroy', 'parent-close']) {
        for (let index=0; index<12; index++) {
          const parent = new BrowserWindow({show:false});
          const child = new BrowserWindow({parent, show:true, webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false}});
          await child.loadFile(page);
          child.focus();
          await child.webContents.executeJavaScript('document.querySelector("input").focus()');
          type(child);
          if (index%2) await delay(5);
          if (mode==='child-destroy') child.destroy();
          else {
            const closed = new Promise(resolve => parent.once('closed', resolve));
            parent.close();
            await closed;
          }
          if (!child.isDestroyed()) child.destroy();
          if (!parent.isDestroyed()) parent.destroy();
          await delay(5);
        }
      }
      assert.equal(BrowserWindow.getAllWindows().length,1);
      console.log('Autofill keyboard selection and 24 native teardown cases passed; Electron '+process.versions.electron);
      keeper.destroy();app.exit(0);
    }).catch(error => {console.error(error);app.exit(1)});
  `,
  );
  const binary = process.env.ZCODE_ELECTRON_TEST_BINARY ?? require("electron");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [entry], {
      stdio: "inherit",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal });
    });
  });
  if (result.code !== 0) throw new Error(`Autofill native test failed: ${JSON.stringify(result)}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
