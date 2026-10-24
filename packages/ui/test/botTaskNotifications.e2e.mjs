// Production hooks, shared index transport and settings; synthetic Hosts, no real messages.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { verifyPausedAcpTurnNotifications } from "./botTaskNotificationScenarios.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = join(repo, "packages/desktop/src/renderer");
const name = `__bot-notifications-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const artifacts = await mkdtemp(join(tmpdir(), "zcode-bot-notifications-"));
let server;
let browser;
try {
  await writeFile(
    html,
    `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ServiceProvider} from '../../../ui/src/hooks/useServices.tsx';
    import {useBotTaskNotifier} from '../../../ui/src/hooks/useBotTaskNotifier.ts';
    import {BotWorkspaceNotifications} from '../../../ui/src/root/BotWorkspaceNotifications.tsx';
    import {useRemoteWorkspaceSessionStore as remote} from '../../../ui/src/store/remoteWorkspaceSessionStore.ts';
    import {useWorkTaskNotifications} from '../../../ui/src/hooks/useWorkTaskNotifications.ts';
    import {TaskNotificationsCard} from '../../../ui/src/BotsDialog/TaskNotificationsCard.tsx';
    import {SettingsGroupCard} from '../../../ui/src/settings/SettingsPageParts.tsx';
    import {ZCodeIntlProvider,useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
    import {applyTheme} from '../../../ui/src/useTheme.ts';
    import '../../../ui/src/styles.css';
    const params=new URLSearchParams(location.search),locale=params.get('locale')||'zh-CN';
    const mode=params.get('mode')||'desktop-continuous';
    const s:any={sent:[],commands:[],native:[],acp:[],tasks:[],index:[],subs:[],tests:[],failTest:false,deferTest:false};window.__fixture=s;
    const bot={id:'bot',name:'Synthetic',provider:'telegram',enabled:true,providerUserId:'recipient',allowedWorkspaces:['*'],allowedCommands:{},currentOptions:{},replyMode:'summary_changes',taskNotifications:false};
    const apiRow=(patch:any={})=>({sessionId:'api',workspaceId:'remote:one',title:'API task',phase:'running',sessionEnded:false,hasBackgroundWork:false,lastActivityAt:1,createdAt:1,...patch});
    const task=(patch:any={})=>({id:'work',title:'Work task',workspacePath:'/fixture',workspaceIdentity:'remote:one',status:'running',execution:{kind:'api'},runSeq:1,updatedAt:1,archived:false,stopPending:false,...patch});
    const acpRow=(patch:any={})=>({id:'acp',workspacePath:'/fixture',workspaceIdentity:'remote:one',agent:'codex',acpSessionId:'native',title:'ACP task',status:'running',revision:1,entries:[{kind:'user',id:'user:one',text:'private text must not be forwarded',createdAt:1}],pendingPermission:null,pendingElicitation:null,error:null,queue:{items:[],autoDrain:true},...patch});
    s.apiRow=apiRow;s.task=task;s.acpRow=acpRow;s.rows=[task()];
    const botsService={async notifyTask(event){s.commands.push(event);if(s.bot?.taskNotifications)s.sent.push(event)},async testTaskNotification(id){s.tests.push(id);if(s.deferTest)return new Promise(resolve=>s.finishTest=resolve);return {ok:!s.failTest}}};
    const workTaskService={async list(scope){return {tasks:structuredClone(scope.workspacePath==='/linked'?[]:s.rows),concurrency:1}},onDynamicChanged:scope=>fn=>{const l={scope,fn,live:true};s.tasks.push(l);return {dispose(){l.live=false}}}};
    const acpService={async listSummaries(scope){return [acpRow(scope)]},onDynamicSessionSummaryChanged:scope=>fn=>{const l={scope,fn,live:true};s.acp.push(l);return {dispose(){l.live=false}}}};
    let count=0;
    const zcodeAgentService={
      async helloConversationV4(){return {kind:'hello',protocolVersion:3,connectionId:'synthetic',clientMode:mode,deliveryProfile:mode==='desktop-continuous'?'continuous':'replayable',serverTime:1,capabilities:{nativeDialogs:false,localTerminal:false,binaryFrames:false,compression:'none'},auth:{}}},
      async initializeConversationV4(){},
      async subscribeSessionsIndexV4(scope){const sub={...scope,id:'index-'+(++count),seq:0,ordinal:0};s.subs.push(sub);queueMicrotask(()=>s.indexFrame([apiRow()], 'initial',sub));return {ack:{subscriptionId:sub.id,mode:'snapshot',logEpoch:'epoch'}}},
      async unsubscribeSessionsIndexV4(){},async resyncSessionsIndexV4(){throw Error('unexpected gap')},
      onDynamicSessionsIndexFrame:scope=>fn=>{const l={scope,fn,live:true};s.index.push(l);return {dispose(){l.live=false}}},
      onAgentRuntimeRestarted:()=>({dispose(){}}),
    };
    s.indexFrame=(rows,delivery='online',sub=s.subs.at(-1))=>{const key=sub.workspaceIdentity||sub.workspacePath;const topic='sessions-index/'+key;const from=sub.seq;sub.seq++;sub.ordinal++;const snapshot=delivery!=='online';const frame={topic,subscriptionId:sub.id,fromSeq:from,toSeq:sub.seq,sentAt:1,payload:snapshot?{kind:'snapshot',snapshot:{protocolVersion:1,workspaceId:key,logEpoch:'epoch',sessions:rows}}:{kind:'deltas',deltas:rows.map(session=>({op:'session.upserted',session}))}};const wire={wireVersion:3,kind:'complete',deliveryKind:delivery,logicalFrameId:'frame-'+sub.id+'-'+sub.ordinal,logicalFrameOrdinal:sub.ordinal,topic,subscriptionId:sub.id,frame};for(const x of s.index)if(x.live&&(x.scope.workspaceIdentity||x.scope.workspacePath)===key)x.fn(wire)};
    s.emitAcp=(patch,index=s.acp.findLastIndex(x=>x.live))=>{const x=s.acp[index];x.fn({kind:'updated',session:acpRow({...x.scope,...patch})})};
    s.emitWork=patch=>{s.rows=[task(patch)];for(const x of s.tasks)if(x.live)x.fn()};
    const gitService={async getWorkspaceRepositoryInfo({workspacePath}){return {workspacePath,repoRoot:workspacePath,kind:workspacePath==='/linked'?'linked-worktree':'main-tree',mainWorktreePath:'/parent'}}};
    const services:any={botsService,workTaskService,acpService,zcodeAgentService,gitService};
    remote.getState().registerBaseServices(services);
    for(const id of ['one','two']){remote.getState().registerSession({sessionId:'attachment:'+id,services});remote.getState().bindWorkspaceIdentity('remote:'+id,'attachment:'+id)}
    const platform:any={showTaskNotification(event){s.native.push(event)},onTaskNotificationClick(){return ()=>{}}};
    function Fixture(){
      const [current,setBot]=useState(()=>({...bot,...JSON.parse(localStorage.getItem('synthetic-bot')||'{}')}));
      const [scope,setScope]=useState({workspacePath:'/fixture',workspaceIdentity:'remote:one',remoteSessionId:'attachment:one'});
      const [ready,setReady]=useState(true),[epoch,setEpoch]=useState(0),[enabled,setEnabled]=useState(false);
      const {intl}=useZCodeIntl();s.bot=current;s.setBot=setBot;s.setScope=setScope;s.setReady=setReady;s.remount=()=>setEpoch(x=>x+1);s.os=setEnabled;s.theme=applyTheme;
      const patch=update=>setBot(value=>{const next={...value,...update};localStorage.setItem('synthetic-bot',JSON.stringify(next));return next});
      return <main className='min-h-screen bg-background p-4 text-foreground'><SettingsGroupCard><TaskNotificationsCard key={current.id} bot={current} weixinRecipientReady={false} onPatchBot={patch}/></SettingsGroupCard><Observer key={epoch} scope={scope} ready={ready} enabled={enabled} intl={intl}/><span id='ready'>ready</span></main>;
    }
    function Observer({scope,ready,enabled,intl}){
      const [extra,setExtra]=useState<any[]>([]);s.setExtra=setExtra;
      const botNotifier=useBotTaskNotifier(scope);
      useWorkTaskNotifications({scope,service:ready?workTaskService:undefined,enabled,platform,botNotifier,formatMessage:intl.formatMessage});
      return <BotWorkspaceNotifications projects={ready?[{id:'project',kind:'workspace',...scope,label:'Project',workspacePurpose:'project'},...extra]:[]}/>;
    }
    applyTheme('zai-light');createRoot(document.getElementById('root')!).render(<React.StrictMode><ServiceProvider services={services}><ZCodeIntlProvider initialLocale={locale}><Fixture/></ZCodeIntlProvider></ServiceProvider></React.StrictMode>);
  `,
  );
  server = await createServer({
    configFile: join(repo, "packages/desktop/vite.config.ts"),
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const [width, mode] of [
    [1280, "desktop-continuous"],
    [320, "web-remote-replayable"],
  ]) {
    for (const locale of ["zh-CN", "en-US"]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.setDefaultTimeout(12_000);
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/${name}.html?locale=${locale}&mode=${mode}`,
      );
      await page.locator("#ready").waitFor();
      await page.waitForFunction(
        () =>
          window.__fixture.subs.length &&
          window.__fixture.acp.some((x) => x.live) &&
          window.__fixture.tasks.some((x) => x.live),
      );
      const label = locale === "zh-CN" ? "任务通知" : "Task notifications";
      const toggle = page.getByRole("switch", { name: label, exact: true });
      assert.equal(await toggle.getAttribute("aria-checked"), "false");
      assert.equal(await page.evaluate(() => window.__fixture.sent.length), 0);
      await toggle.click();
      // System notifications remain disabled. All three live observers still send.
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame([s.apiRow({ phase: "completedSuccess", lastActivityAt: 2 })]);
        s.emitAcp({ status: "idle", revision: 2 });
        s.emitWork({ status: "review", updatedAt: 2 });
      });
      await page
        .waitForFunction(() => window.__fixture.sent.length === 3)
        .catch(async (error) => {
          process.stderr.write(
            JSON.stringify(
              await page.evaluate(() => ({
                sent: window.__fixture.sent,
                commands: window.__fixture.commands,
                subs: window.__fixture.subs,
                bot: window.__fixture.bot,
              })),
            ) +
              "\n" +
              JSON.stringify(errors) +
              "\n",
          );
          throw error;
        });
      assert.deepEqual(
        (await page.evaluate(() => window.__fixture.sent.map((x) => x.source))).sort(),
        ["acp", "api", "work-task"],
      );
      assert.equal(await page.evaluate(() => window.__fixture.native.length), 0);
      assert.equal(
        await page.evaluate(() => JSON.stringify(window.__fixture.sent).includes("private text")),
        false,
      );
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame([s.apiRow({ phase: "completedSuccess", lastActivityAt: 2 })]);
        s.emitAcp({ status: "idle", revision: 3 });
        s.emitWork({ status: "review", updatedAt: 3 });
      });
      // New pending interaction identities notify without forwarding their contents.
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame([
          s.apiRow({
            phase: "running",
            lastActivityAt: 3,
            pendingInteraction: { interactionId: "ask-api", kind: "permission" },
          }),
        ]);
        s.emitAcp({
          revision: 4,
          pendingPermission: { requestId: "ask-acp", title: "private command", options: [] },
        });
        s.emitWork({ status: "running", updatedAt: 4 });
      });
      await page.waitForFunction(() => window.__fixture.sent.length === 5);
      await page.evaluate(() =>
        window.__fixture.emitWork({ status: "awaiting_input", updatedAt: 5 }),
      );
      await page.waitForFunction(() => window.__fixture.sent.length === 6);
      assert.equal(
        await page.evaluate(
          () => window.__fixture.sent.filter((x) => x.status === "awaiting_input").length,
        ),
        3,
      );
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame([s.apiRow({ phase: "running", lastActivityAt: 4 })]);
        s.emitAcp({ revision: 5, entries: [{ kind: "user", id: "user:two", text: "x" }] });
        s.emitWork({ status: "running", updatedAt: 6 });
      });
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame([s.apiRow({ phase: "error", lastActivityAt: 5 })]);
        s.emitAcp({
          status: "idle",
          revision: 6,
          error: "private error",
          entries: [{ kind: "user", id: "user:two", text: "x" }],
        });
        s.emitWork({ status: "failed", updatedAt: 7 });
      });
      await page.waitForFunction(() => window.__fixture.sent.length === 9);
      // Recovery snapshots are baselines, including a recovery to a different terminal state.
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame([s.apiRow({ phase: "completedSuccess", lastActivityAt: 9 })], "recovery");
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(await page.evaluate(() => window.__fixture.sent.length), 9);
      await page.evaluate(() => window.__fixture.remount());
      await page.waitForFunction(() => window.__fixture.subs.length >= 2);
      assert.equal(await page.evaluate(() => window.__fixture.sent.length), 9);
      // Old scope callbacks and frames cannot notify after switching attachment + identity.
      const oldAcp = await page.evaluate(() => window.__fixture.acp.findLastIndex((x) => x.live));
      await page.evaluate(() =>
        window.__fixture.setScope({
          workspacePath: "/fixture",
          workspaceIdentity: "remote:two",
          remoteSessionId: "attachment:two",
        }),
      );
      await page.waitForFunction(() =>
        window.__fixture.acp.some((x) => x.live && x.scope.workspaceIdentity === "remote:two"),
      );
      await page.evaluate(
        (index) => window.__fixture.emitAcp({ status: "idle", revision: 100 }, index),
        oldAcp,
      );
      assert.equal(await page.evaluate(() => window.__fixture.sent.length), 9);
      // A different open project observes its own events while the current project stays unchanged.
      await page.evaluate(() =>
        window.__fixture.setExtra([
          {
            id: "background",
            kind: "workspace",
            workspacePath: "/fixture",
            workspaceIdentity: "remote:one",
            remoteSessionId: "attachment:one",
            label: "Background",
          },
        ]),
      );
      await page.waitForFunction(() =>
        window.__fixture.acp.some((x) => x.live && x.scope.workspaceIdentity === "remote:one"),
      );
      const background = await page.evaluate(() =>
        window.__fixture.acp.findLastIndex(
          (x) => x.live && x.scope.workspaceIdentity === "remote:one",
        ),
      );
      await page.evaluate(
        (index) => window.__fixture.emitAcp({ status: "idle", revision: 2 }, index),
        background,
      );
      await page.waitForFunction(() => window.__fixture.sent.length === 10);
      assert.equal(
        await page.evaluate(() => window.__fixture.sent.at(-1).workspaceIdentity),
        "remote:one",
      );
      assert.equal(
        await page.evaluate(() => window.__fixture.sent.at(-1).remoteSessionId),
        "attachment:one",
      );
      await page.evaluate(() =>
        window.__fixture.setExtra([
          {
            id: "unresolved",
            kind: "workspace",
            workspacePath: "/unresolved",
            remoteTarget: { kind: "ssh" },
            label: "Disconnected",
          },
        ]),
      );
      await page.waitForFunction(
        () =>
          !window.__fixture.acp.some((x) => x.live && x.scope.workspaceIdentity === "remote:one"),
      );
      await page.evaluate(
        (index) =>
          window.__fixture.emitAcp(
            { revision: 3, pendingPermission: { requestId: "closed", title: "x", options: [] } },
            index,
          ),
        background,
      );
      assert.equal(await page.evaluate(() => window.__fixture.sent.length), 10);
      assert.equal(
        await page.evaluate(() =>
          window.__fixture.subs.some((x) => x.workspacePath === "/unresolved"),
        ),
        false,
      );
      // Linked worktree task bindings belong to the parent board, not the execution path.
      await page.evaluate(() => {
        const s = window.__fixture;
        s.rows = [
          s.task({
            workspacePath: "/parent",
            workspaceIdentity: undefined,
            session: { kind: "api", id: "api" },
            worktree: { path: "/linked" },
          }),
          s.task({
            id: "acp-work",
            workspacePath: "/parent",
            workspaceIdentity: undefined,
            session: { kind: "acp", id: "acp" },
            worktree: { path: "/linked" },
          }),
        ];
        s.setScope({ workspacePath: "/parent" });
        s.setExtra([
          { id: "linked", kind: "workspace", workspacePath: "/linked", label: "Linked" },
        ]);
      });
      await page.waitForFunction(() =>
        window.__fixture.acp.some((x) => x.live && x.scope.workspacePath === "/linked"),
      );
      await page.evaluate(() => {
        const s = window.__fixture;
        const linked = s.subs.findLast((x) => x.workspacePath === "/linked");
        s.indexFrame(
          [s.apiRow({ phase: "completedSuccess", lastActivityAt: 20 })],
          "online",
          linked,
        );
        s.emitAcp(
          { workspaceIdentity: undefined, status: "idle", revision: 20 },
          s.acp.findLastIndex((x) => x.live && x.scope.workspacePath === "/linked"),
        );
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal(await page.evaluate(() => window.__fixture.sent.length), 10);
      // Unbound ordinary sessions in the same worktree must still notify.
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame(
          [s.apiRow({ sessionId: "ordinary", phase: "running", lastActivityAt: 21 })],
          "online",
          s.subs.findLast((x) => x.workspacePath === "/linked"),
        );
      });
      await page.evaluate(() => {
        const s = window.__fixture;
        s.indexFrame(
          [s.apiRow({ sessionId: "ordinary", phase: "completedSuccess", lastActivityAt: 22 })],
          "online",
          s.subs.findLast((x) => x.workspacePath === "/linked"),
        );
      });
      await page.waitForFunction(() => window.__fixture.sent.length === 11);
      assert.equal(
        await page.evaluate(() => window.__fixture.sent.at(-1).workspacePath),
        "/linked",
      );
      await verifyPausedAcpTurnNotifications(page, 11);
      const testLabel = locale === "zh-CN" ? "发送测试通知" : "Send test notification";
      await page.getByRole("button", { name: testLabel, exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: locale === "zh-CN" ? "测试通知已发送" : "Test notification sent" })
        .waitFor();
      await page.evaluate(() => {
        window.__fixture.failTest = true;
      });
      await page.getByRole("button", { name: testLabel, exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: locale === "zh-CN" ? "发送失败" : "Delivery failed" })
        .waitFor();
      for (const theme of ["zai-light", "zai-dark"]) {
        await page.evaluate((value) => window.__fixture.theme(value), theme);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({ path: join(artifacts, `${locale}-${width}-${theme}.png`) });
      }
      // A late test response for a different selected bot must be discarded.
      await page.evaluate(() => {
        window.__fixture.deferTest = true;
      });
      await page.getByRole("button", { name: testLabel, exact: true }).click();
      await page.evaluate(() =>
        window.__fixture.setBot((value) => ({ ...value, id: "other", providerUserId: undefined })),
      );
      await page.waitForFunction(() => window.__fixture.bot.id === "other");
      await page.evaluate(() => window.__fixture.finishTest({ ok: true }));
      assert.equal(await toggle.isDisabled(), true);
      assert.equal(await page.getByRole("status").innerText(), "");
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  process.stdout.write(
    `PASS: bot settings + API/ACP/work-task live completion/failure/wait, OS-off independence, recovery and stale scope guards; screenshots: ${artifacts}\n`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
