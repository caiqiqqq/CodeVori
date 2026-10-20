// Real shared API/ACP list with fake Host metadata; no prompts, credentials or user history.
// Run against desktop Vite: node packages/ui/test/worktreeConversationRows.e2e.mjs
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__worktree-rows-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><meta charset="UTF-8"><div id="root"></div><script type="module" src="./${name}.tsx"></script>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { WorkspaceTimelineTasksSection } from '../../../ui/src/WorkspaceTimelineTasksSection.tsx';
    import { WorkspacePinnedTasksSection } from '../../../ui/src/WorkspacePinnedTasksSection.tsx';
    import { TaskList } from '../../../ui/src/TaskList.tsx';
    import { PlatformProvider } from '../../../ui/src/hooks/usePlatform.tsx';
    import { ServiceProvider } from '../../../ui/src/hooks/useServices.tsx';
    import { TabStoreProvider } from '../../../ui/src/store/TabStoreProvider.tsx';
    import { ZCodeIntlProvider } from '../../../ui/src/i18n/IntlProvider.tsx';
    import { TooltipProvider } from '../../../ui/src/components/ui/tooltip.tsx';
    import '../../../ui/src/styles.css';
    const mainPath = '/fixture/repo';
    const treePath = '/fixture/worktrees/ab12/repo';
    const otherPath = '/fixture/worktrees/cd34/repo';
    const paths = [mainPath, treePath, otherPath];
    const tabs = paths.map((workspacePath, i) => ({ id: String(i), kind: 'workspace', label: 'repo', workspacePath }));
    const treeKeys = new Set([treePath, otherPath]);
    const emptyMode = new URLSearchParams(location.search).has('empty');
    const emptyTabs = ['/fixture/empty/repo','/fixture/empty/worktrees/ab12/repo'].map((workspacePath, i) =>
      ({id:'empty-'+i,kind:'workspace',label:'empty',workspacePath}));
    const now = Date.now();
    const api = Array.from({length: 25}, (_, i) => ({ taskId: 'api-' + i, workspacePath: paths[i % 3],
      title: 'API 对话 ' + i, provider: 'glm', status: 'idle', createdAt: now - i * 10000, updatedAt: now - (24 - i) * 10000 }));
    const acp = paths.map((workspacePath, i) => ({ id: 'acp-' + i, agent: i ? 'codex' : 'claude', workspacePath,
      title: '智能体对话 ' + i, status: 'ready', revision: 1, entries: [{ kind: 'user', text: 'fixture', createdAt: now - 5000 - i * 10000 }] }));
    const listeners = new Map();
    const apiPinned = new Set();
    window.__seedApiPinned = () => apiPinned.add('api-1');
    window.__rowSelections = [];
    window.__rowWrites = [];
    const services = {
      zcodeTaskService: { getTaskSessionFilePath: async () => ({path: treePath + '/session.json', exists: true}),
        getTaskNativeSessionLogFile: async () => ({path: treePath + '/log.json', exists: true}),
        setTaskPinned: async input => { window.__rowWrites.push(input); return {...api.find(t => t.taskId === input.taskId)}; } },
      acpService: {
        list: async workspace => acp.filter(s => s.workspacePath === workspace.workspacePath),
        onDynamicSessionChanged: workspace => callback => { listeners.set(workspace.workspacePath, callback); return {dispose(){listeners.delete(workspace.workspacePath)}}; },
        updateRow: async input => { window.__rowWrites.push(input); const session=acp.find(s=>s.id===input.id); session.pinned=input.action.pinned; session.revision++; listeners.get(session.workspacePath)?.({kind:'updated',session}); },
      },
      windowControllerService: {
        onDynamicControllerFrame: () => () => ({dispose(){}}),
        subscribeControllerV4: async () => ({ack:{subscriptionId:crypto.randomUUID()}}),
        unsubscribeControllerV4: async () => {},
        listTaskList: async query => {
          const source = api.filter(t => query.kind === 'pinned' ? apiPinned.has(t.taskId) : query.workspaceScopes.some(s => s.workspacePath === t.workspacePath));
          const ordered = [...source].sort((a,b) => b[query.sortBy+'At'] - a[query.sortBy+'At']);
          return {items:ordered.slice(0,query.limit), total:source.length, hasMore:ordered.length>(query.limit??Infinity)};
        },
      },
    };
    function Fixture() {
      const [sortBy, setSortBy] = useState('updated');
      const [pinned, setPinned] = useState(false);
      const [variant, setVariant] = useState('default');
      const [active, setActive] = useState({workspacePath:mainPath,id:null,kind:null});
      window.__setRowsSort = setSortBy;
      window.__setRowsPinned = setPinned;
      window.__setRowsVariant = setVariant;
      const props = { workspaceTabs:tabs, activeWorkspacePath:active.workspacePath,
        activeTaskId:active.kind==='api'?active.id:null, activeAcpSessionId:active.kind==='acp'?active.id:null,
        taskSortBy:sortBy, worktreeWorkspaceKeys:treeKeys,
        onSelectTask:(workspacePath,id)=>{ window.__rowSelections.push({workspacePath,id,kind:'api'}); setActive({workspacePath,id,kind:'api'}); },
        onSelectAcpSession:session=>{ window.__rowSelections.push({workspacePath:session.workspacePath,id:session.id,kind:'acp'}); setActive({workspacePath:session.workspacePath,id:session.id,kind:'acp'}); },
      };
      if (emptyMode) return <main style={{width:'min(300px, calc(100vw - 24px))',margin:'20px 12px',backgroundColor:'var(--color-sidebar)'}}>
        <section data-testid="empty-ordinary"><TaskList workspacePath={emptyTabs[0].workspacePath}
          tasks={[]} acpSessions={[]} activeTaskId={null} onSelectTask={()=>{}} loading={false}
          showCreateButton={false} showFooter={false} onRenameTask={async()=>null}
          onSetTaskPinned={async()=>null} onArchiveTask={async()=>null} onSetTaskUnread={async()=>null}/></section>
        <section data-testid="empty-worktree"><WorkspaceTimelineTasksSection workspaceTabs={emptyTabs}
          activeWorkspacePath={emptyTabs[0].workspacePath} activeTaskId={null} taskSortBy="updated"
          taskRowVariant="default" groupByDate={false} onSelectTask={()=>{}}/></section>
        <section data-testid="empty-timeline"><WorkspaceTimelineTasksSection workspaceTabs={emptyTabs}
          activeWorkspacePath={emptyTabs[0].workspacePath} activeTaskId={null} taskSortBy="updated"
          taskRowVariant="timeline" groupByDate={false} onSelectTask={()=>{}}/></section>
      </main>;
      return <main style={{width:'min(300px, calc(100vw - 24px))',margin:'20px 12px',backgroundColor:'var(--color-sidebar)'}} data-testid="rows-fixture" data-variant={variant}>
        {pinned ? <WorkspacePinnedTasksSection {...props as never}/> : <WorkspaceTimelineTasksSection {...props as never} taskRowVariant={variant} groupByDate={false}/>}
      </main>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={{isWeb:true,isLinux:true,isMacOS:false,isWindows:false} as never}>
      <TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider>
        <Fixture/>
      </TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider>
    </PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`http://localhost:5174/${name}.html?empty`);
      await page.evaluate((value) => {
        document.documentElement.className =
          value === "dark" ? "dark theme-zai-dark" : "theme-zai-light";
      }, theme);
      const ordinaryEmpty = page
        .getByTestId("empty-ordinary")
        .getByText("暂无任务", { exact: true });
      const worktreeEmpty = page
        .getByTestId("empty-worktree")
        .getByText("暂无任务", { exact: true });
      const timelineEmpty = page
        .getByTestId("empty-timeline")
        .getByText("暂无任务", { exact: true });
      await ordinaryEmpty.waitFor();
      await worktreeEmpty.waitFor();
      await timelineEmpty.waitFor();
      const emptyPresentation = async (locator) =>
        locator.evaluate((element) => {
          const style = getComputedStyle(element);
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            textLeft: range.getBoundingClientRect().left,
            color: style.color,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            height: element.getBoundingClientRect().height,
            overflow: element.scrollWidth > element.clientWidth,
          };
        });
      const ordinaryPresentation = await emptyPresentation(ordinaryEmpty);
      const worktreePresentation = await emptyPresentation(worktreeEmpty);
      const timelinePresentation = await emptyPresentation(timelineEmpty);
      await page.screenshot({ path: `/tmp/codevori-project-empty-${width}-${theme}.png` });
      assert.deepEqual(
        worktreePresentation,
        ordinaryPresentation,
        "普通项目和工作树项目的空提示应具有相同的文字位置、颜色和字号",
      );
      assert.equal(ordinaryPresentation.overflow, false);
      assert.ok(timelinePresentation.textLeft < ordinaryPresentation.textLeft);
      assert.notEqual(timelinePresentation.color, ordinaryPresentation.color);
      await page.goto(`http://localhost:5174/${name}.html`);
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      const fixture = page.getByTestId("rows-fixture");
      const rows = fixture.locator("[data-task-item-key], [data-acp-session-id]");
      await page.waitForFunction(
        () =>
          document.querySelectorAll("[data-task-item-key], [data-acp-session-id]").length === 20,
      );
      assert.equal(await fixture.locator('[data-testid^="workspace-item-"]').count(), 0);
      assert.equal(await rows.first().getAttribute("data-testid"), "task-item-api-24");
      await page.getByText("显示更多", { exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll("[data-task-item-key], [data-acp-session-id]").length === 28,
      );
      for (const row of await rows.all()) {
        assert.doesNotMatch(
          await row.innerText(),
          /(?:^|\n)(?:刚刚|\d+\s*(?:秒|分|小时|天|周|月|年))(?:$|\n)/,
          "API/ACP sidebar rows must not display relative time labels",
        );
      }
      const apiRow = page.getByTestId("task-item-api-1");
      const acpRow = page.getByTestId("acp-task-item-acp-1");
      assert.equal(await apiRow.locator('[data-task-agent-icon="api"]').isVisible(), true);
      assert.equal(await acpRow.locator('[data-acp-agent-icon="codex"]').isVisible(), true);
      assert.equal(
        await apiRow
          .locator("[title], p")
          .first()
          .evaluate((el) => el.getBoundingClientRect().left),
        await acpRow
          .locator("[title], p")
          .first()
          .evaluate((el) => el.getBoundingClientRect().left),
        "API and ACP titles align beside their Agent icons",
      );
      for (const variant of ["default", "timeline"]) {
        await page.evaluate((value) => window.__setRowsVariant(value), variant);
        await page.waitForFunction(
          (value) =>
            document.querySelector('[data-testid="rows-fixture"]').dataset.variant === value,
          variant,
        );
        for (const row of [apiRow, acpRow]) {
          await page.mouse.move(width - 2, 2);
          await page.evaluate(() => document.activeElement?.blur());
          const marker = row.getByTestId("worktree-conversation-indicator");
          await marker.waitFor();
          assert.equal(await marker.evaluate((el) => el.tabIndex), -1);
          assert.match(
            await row.getAttribute("aria-description"),
            /工作树对话.*\/fixture\/worktrees\/ab12\/repo/,
          );
          assert.equal(await row.locator("[data-task-row-actions]").count(), 0);
          const title = row.locator("[title], p").first();
          const before = await title.evaluate((el) => el.getBoundingClientRect().left);
          const height = await row.evaluate((el) => el.getBoundingClientRect().height);
          const screenshotName = row === apiRow ? "api" : "acp";
          if (width === 1280 && theme === "dark" && variant === "default")
            await row.screenshot({ path: `/tmp/zcode-worktree-${screenshotName}-idle.png` });
          await row.hover();
          await row.getByRole("button", { name: "置顶任务", exact: true }).waitFor();
          await row.getByRole("button", { name: "归档任务", exact: true }).waitFor();
          assert.equal(await marker.count(), 0, "Hover swaps the marker for the action group");
          assert.equal(
            await row.locator("[data-task-agent-icon], [data-acp-agent-icon]").isVisible(),
            true,
          );
          if (width === 1280 && theme === "dark" && variant === "default")
            await row.screenshot({ path: `/tmp/zcode-worktree-${screenshotName}-hover.png` });
          const layout = await row.evaluate((el) => {
            const pin = el.querySelector('button[aria-label="置顶任务"]');
            const archive = el.querySelector('button[aria-label="归档任务"]');
            const pr = pin.getBoundingClientRect(),
              ar = archive.getBoundingClientRect();
            const group = pin.closest('[data-task-row-actions="true"]');
            return {
              width: pr.width,
              height: pr.height,
              archiveWidth: ar.width,
              archiveHeight: ar.height,
              gap: ar.left - pr.right,
              sameTop: pr.top === ar.top,
              sameGroup: Boolean(group?.contains(archive)),
              leadingButtons: el.firstElementChild.querySelectorAll("button").length,
              trailingGap: el.getBoundingClientRect().right - ar.right,
            };
          });
          assert.deepEqual(layout, {
            width: 24,
            height: 24,
            archiveWidth: 24,
            archiveHeight: 24,
            gap: 2,
            sameTop: true,
            sameGroup: true,
            leadingButtons: 0,
            trailingGap: 4,
          });
          assert.equal(await title.evaluate((el) => el.getBoundingClientRect().left), before);
          assert.equal(await row.evaluate((el) => el.getBoundingClientRect().height), height);
          await page.mouse.move(width - 2, 2);
          await row.focus();
          await row.getByRole("button", { name: "归档任务", exact: true }).waitFor();
          assert.equal(await marker.count(), 0, "Keyboard focus swaps the marker for actions");
          assert.equal(await row.locator("[data-task-row-actions] button").count(), 2);
          if (row === acpRow)
            assert.equal(await row.locator("[data-acp-agent-icon]").isVisible(), true);
          await page.evaluate(() => document.activeElement?.blur());
          await marker.waitFor();
          assert.equal(await row.locator("[data-task-row-actions]").count(), 0);
          await row.hover();
          const archive = row.getByRole("button", { name: "归档任务", exact: true });
          const archiveElement = await archive.elementHandle();
          await archive.click();
          await row.getByRole("button", { name: "确认", exact: true }).waitFor();
          assert.equal(
            await archiveElement.evaluate((el) => el.isConnected),
            true,
            "Confirmation preserves the hovered/focused button",
          );
          await archiveElement.dispose();
          await page.mouse.move(width - 2, 2);
          assert.equal(
            await marker.count(),
            0,
            "Archive confirmation retains actions after mouse leave",
          );
          await row.getByRole("button", { name: "置顶任务", exact: true }).waitFor();
          await page.keyboard.press("Escape");
          await page.evaluate(() => document.activeElement?.blur());
          await marker.waitFor();
          assert.equal(await title.evaluate((el) => el.getBoundingClientRect().left), before);
          assert.equal(await row.evaluate((el) => el.getBoundingClientRect().height), height);
        }
      }
      assert.deepEqual(await page.evaluate(() => window.__rowWrites), []);
      assert.deepEqual(await page.evaluate(() => window.__rowSelections), []);
      await page.evaluate(() => window.__setRowsVariant("default"));
      await page.waitForFunction(
        () => document.querySelector('[data-testid="rows-fixture"]').dataset.variant === "default",
      );
      for (const row of [apiRow, acpRow]) {
        await page.mouse.move(width - 2, 2);
        await page.evaluate(() => document.activeElement?.blur());
        const marker = row.getByTestId("worktree-conversation-indicator");
        assert.equal(await marker.count(), 1);
        assert.equal(
          await marker.getAttribute("data-worktree-path"),
          "/fixture/worktrees/ab12/repo",
        );
        const layout = await row.evaluate((el) => {
          const rr = el.getBoundingClientRect();
          const mr = el.querySelector("[data-worktree-path]").getBoundingClientRect();
          return { gap: rr.right - mr.right, overflow: el.scrollWidth - el.clientWidth };
        });
        assert.ok(layout.gap < 10, "Worktree marker stays at the trailing edge");
        assert.equal(layout.overflow, 0);
        await row.click();
      }
      for (const id of ["task-item-api-0", "acp-task-item-acp-0"]) {
        assert.equal(
          await page.getByTestId(id).getByTestId("worktree-conversation-indicator").count(),
          0,
        );
      }
      assert.deepEqual(await page.evaluate(() => window.__rowSelections), [
        { workspacePath: "/fixture/worktrees/ab12/repo", id: "api-1", kind: "api" },
        { workspacePath: "/fixture/worktrees/ab12/repo", id: "acp-1", kind: "acp" },
      ]);
      await page.evaluate(() => window.__setRowsSort("created"));
      await page.waitForFunction(
        () =>
          document.querySelectorAll("[data-task-item-key], [data-acp-session-id]").length === 20,
      );
      assert.equal(await rows.first().getAttribute("data-testid"), "task-item-api-0");
      await acpRow.hover();
      await acpRow.getByRole("button", { name: "置顶任务", exact: true }).click();
      await acpRow.waitFor({ state: "detached" });
      assert.deepEqual(await page.evaluate(() => window.__rowWrites), [
        {
          id: "acp-1",
          workspacePath: "/fixture/worktrees/ab12/repo",
          action: { kind: "pin", pinned: true },
        },
      ]);
      await page.evaluate(() => {
        window.__seedApiPinned();
        window.__setRowsPinned(true);
      });
      await acpRow.waitFor();
      await apiRow.waitFor();
      for (const row of [apiRow, acpRow]) {
        await page.mouse.move(width - 2, 2);
        await page.evaluate(() => document.activeElement?.blur());
        await row.getByTestId("worktree-conversation-indicator").waitFor();
        assert.equal(
          await row.getByRole("button", { name: "取消置顶任务", exact: true }).count(),
          0,
        );
        await row.focus();
        await row.getByRole("button", { name: "取消置顶任务", exact: true }).waitFor();
        assert.equal(await row.getByTestId("worktree-conversation-indicator").count(), 0);
      }
      const noOverflow = await fixture.evaluate((el) => el.scrollWidth === el.clientWidth);
      assert.equal(noOverflow, true);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  process.stdout.write(
    "PASS: project empty hints align in both widths/themes; idle worktree markers swap with API/ACP pin/archive on hover/focus/confirmation, both variants, pinned layout, real path selection, merged sorting/pagination.\n",
  );
} finally {
  await browser?.close();
  await rm(html, { force: true });
  await rm(moduleFile, { force: true });
}
