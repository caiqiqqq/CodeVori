// Real Native/ACP/WorkTask menus and Agent board; synthetic Host services.
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { agentBoardFixture } from "./agentBoardFixture.mjs";
const renderer = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__agent-board-add-${process.pid}`;
const html = join(renderer, `${name}.html`),
  moduleFile = join(renderer, `${name}.tsx`);
const artifacts = new URL("../../../output/agent-board-validation/", import.meta.url).pathname;
let browser;
try {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  const imports = `
import {useTabStoreApi} from '../../../ui/src/store/TabStoreProvider.tsx';
import {TaskListItemContextMenuContent} from '../../../ui/src/TaskListItem.tsx';
import {WorkspaceAcpTaskItem} from '../../../ui/src/WorkspaceAcpTaskItem.tsx';
import {WorkTaskActions} from '../../../ui/src/work-tasks/WorkTaskActions.tsx';
import {ContextMenu,ContextMenuTrigger} from '../../../ui/src/components/ui/context-menu.tsx';
import {useZCodeIntl} from '../../../ui/src/i18n/IntlProvider.tsx';
const mockPaths={getTaskSessionFilePath:async()=>({path:null,exists:false}),getTaskNativeSessionLogFile:async()=>({path:null,exists:false})};
services.zcodeTaskService=mockPaths;
for(const session of Object.values(useRemoteWorkspaceSessionStore.getState().sessionsById)) session.services.zcodeTaskService=mockPaths;
const mockTask={workspacePath:'/fixture/project-3',id:'menu-work',title:'Menu work task',prompt:'Fixture',status:'review',execution:{kind:'api',mode:'build',modelSelection:{providerId:'fixture-provider',modelId:'model'}},session:{kind:'api',id:'bound-session'},archived:false,stopPending:false,runSeq:1,createdAt:100,updatedAt:9000};
workRows.push(mockTask);
function MenuFixture(){
 const {intl}=useZCodeIntl();const tabStore=useTabStoreApi();
 React.useEffect(()=>{tabStore.setState({tabs});},[tabStore]);
 return <aside data-testid="source-menus" style={{width:280,flexShrink:0}}>
  {[0,1,4,22].map(i=><ContextMenu key={i}><ContextMenuTrigger asChild><button className="block p-2" data-testid={'native-menu-'+i}>Native source {i}</button></ContextMenuTrigger>
   <TaskListItemContextMenuContent workspacePath={native[i].workspacePath} remoteSessionId={native[i].remoteSessionId} task={native[i]} intl={intl} isPinned={false} onTogglePinTask={()=>{}} onStartRenameTask={()=>{}} onArchiveTask={()=>{}} onMarkTaskAsUnread={()=>{}}/>
  </ContextMenu>)}
  <ul>{acp.map((session,i)=><div key={i} data-testid={'acp-menu-'+i}><WorkspaceAcpTaskItem session={session} service={{updateRow:async()=>{throw Error('Unexpected Host mutation')}}} active={false} variant="default" onSelect={()=>{}}/></div>)}</ul>
  <WorkTaskActions task={mockTask} panel={{busy:false,executable:true}} menu onOpenConversation={()=>{}} onEdit={()=>{}} onComplete={()=>{}}>{controls=><article data-testid="work-menu" className="p-2">Menu work task {controls}</article>}</WorkTaskActions>
 </aside>;
}
`;
  const fixture = agentBoardFixture
    .replace("function Fixture(){", imports + "\nfunction Fixture(){")
    .replace("<output data-testid='navigation'>", "<MenuFixture/><output data-testid='navigation'>")
    .replace(
      "getWorkspaceRepositoryInfo:async({workspacePath})=>({workspacePath,kind:'not-repository'})",
      "getWorkspaceRepositoryInfo:async({workspacePath})=>workspacePath==='/fixture/project-3'?{workspacePath,kind:'main-tree',repoRoot:workspacePath}:workspacePath==='/fixture/project-4'?{workspacePath,kind:'linked-worktree',mainWorktreePath:'/fixture/project-3',repoRoot:workspacePath}:{workspacePath,kind:'not-repository'}",
    );
  await writeFile(moduleFile, fixture);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ZCODE_E2E_CHROMIUM ??
      "/Users/caiqi/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("zcode-locale-preference", "zh-CN");
  });
  await page.goto(
    (process.env.ZCODE_E2E_VITE_URL ?? "http://127.0.0.1:5186") + "/" + name + ".html",
  );
  await page.getByTestId("native-menu-0").waitFor();
  const add = () =>
    page
      .locator('[role="menu"][data-state="open"]')
      .getByRole("menuitem", { name: "添加到看板", exact: true });
  const settled = () => page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  const open = async (id) => {
    await settled();
    await page.getByTestId(id).click({ button: "right" });
    await page.locator('[role="menu"][data-state="open"]').waitFor();
  };
  const custom = async (tracking) =>
    page.evaluate(
      (tracking) =>
        window.__board.store.getState().setTracking({
          mode: "custom",
          projects: [],
          standalone: false,
          workTasks: false,
          includedItems: [],
          excludedItems: [],
          ...tracking,
        }),
      tracking,
    );
  const hidden = async (id) => {
    await open(id);
    assert.equal(await add().count(), 0);
    await page.keyboard.press("Escape");
  };
  // 显示全部不因临时搜索而提供重复添加入口。
  await hidden("native-menu-0");
  await hidden("acp-menu-0");
  await hidden("work-menu");
  await custom({});
  for (const [row, title] of [
    ["native-menu-0", "Remote API session"],
    ["acp-menu-0", "Remote ACP 0"],
    ["work-menu", "Menu work task"],
  ]) {
    await open(row);
    await add().click();
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await hidden(row);
  }
  assert.equal(await page.locator("[data-board-card]").count(), 3);
  // 完整identity和来源类型隔离，同路径同id的另一Host仍可添加。
  await open("native-menu-1");
  await add().waitFor();
  await page.keyboard.press("Escape");
  await open("acp-menu-1");
  await add().waitFor();
  await page.keyboard.press("Escape");
  // 整项目包含工作树，独立对话整组/待办整组也属于已纳入。
  await custom({ projects: ["/fixture/project-3"], standalone: true, workTasks: true });
  await hidden("native-menu-4");
  await hidden("native-menu-22");
  await hidden("acp-menu-1");
  await hidden("work-menu");
  // 逐条排除优先，菜单解除当前项排除而保留其它规则。
  const excluded = JSON.stringify(["/fixture/project-4", "native", "same-id"]);
  await custom({ projects: ["/fixture/project-3"], excludedItems: [excluded, "unrelated"] });
  await open("native-menu-4");
  await add().click();
  await page.getByRole("heading", { name: "Implement project 4", exact: true }).waitFor();
  await hidden("native-menu-4");
  assert.deepEqual(
    await page.evaluate(() => window.__board.store.getState().tracking.excludedItems),
    ["unrelated"],
  );
  // 菜单打开时偏好变化立即生效；添加不受看板当前搜索结果影响。
  await custom({});
  await open("acp-menu-0");
  await add().waitFor();
  await page.evaluate(() =>
    window.__board.store
      .getState()
      .setTracking({ ...window.__board.store.getState().tracking, projects: ["remote:0"] }),
  );
  await add().waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await custom({});
  await page.evaluate(() => window.__board.store.getState().setSearch("not-a-title"));
  await open("acp-menu-0");
  await add().click();
  await hidden("acp-menu-0");
  await page.evaluate(() => window.__board.store.getState().setSearch(""));
  await page.getByRole("heading", { name: "Remote ACP 0", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Remote ACP 0", exact: true }).waitFor();
  await hidden("acp-menu-0");
  for (const [width, theme] of [
    [1500, "zai-light"],
    [390, "zai-dark"],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => window.__board.setTheme(theme), theme);
    await custom({});
    if (width === 390)
      await page
        .getByTestId("work-menu")
        .getByRole("button", { name: "任务操作", exact: true })
        .click();
    else await open("work-menu");
    await add().waitFor();
    await page.screenshot({
      path: join(artifacts, `board-add-menu-${width}.png`),
      animations: "disabled",
    });
    await add().click();
    await page.getByRole("heading", { name: "Menu work task", exact: true }).waitFor();
    if (width === 390) {
      await page
        .getByTestId("work-menu")
        .getByRole("button", { name: "任务操作", exact: true })
        .click();
      assert.equal(await add().count(), 0);
      await page.keyboard.press("Escape");
    } else await hidden("work-menu");
  }
  assert.deepEqual(await page.evaluate(() => window.__board.commands), []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Native/ACP/work-task real menus add to board; membership hides duplicates; project/worktree/standalone/work-task groups; explicit exclusions; remote identity/type isolation; reactive preferences; persistence; desktop context and mobile more menu.",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
