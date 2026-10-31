import assert from "node:assert/strict";

export async function installBoardToolsScenario(stub) {
  await stub(
    "agent-board/AgentBoardPanel.tsx",
    `import {WorkspaceHeaderActionSection} from '/@fs${new URL("../src/WorkspaceHeaderSections/WorkspaceHeaderActionSection.tsx", import.meta.url).pathname}';
     export function AgentBoardPanel({workspaceTools,conversationOptions}){const R=window.__React;window.__tools.boardOptions=conversationOptions;
       R.useLayoutEffect(()=>{workspaceTools.onTargetChange({taskId:'board',workspacePath:'/synthetic/trees/board/project',nativeSessionId:'board-session',sidePaneOwnerId:'board-session'});return()=>workspaceTools.onTargetChange(null)},[workspaceTools.onTargetChange]);
       return R.createElement('section',{'data-testid':'shell-board'},R.createElement(WorkspaceHeaderActionSection,{...workspaceTools.header,workspaceAbsPath:'/synthetic/trees/board/project'}),R.createElement('button',{onClick:()=>workspaceTools.actions.onOpenGitReview()},'Board review'));
     }`,
  );
}

export async function verifyBoardToolsScenario(page, side) {
  const frame = await side.elementHandle();
  await page.evaluate(() => window.__tools.view("agent-board"));
  await page.waitForFunction(() => window.__tools.target?.taskId === "board");
  await page.getByRole("button", { name: "Board review", exact: true }).click();
  await side.getByTestId("tool-git").waitFor();
  assert.equal(
    await side.getByTestId("tool-git").getAttribute("data-workspace"),
    "/synthetic/trees/board/project",
  );
  assert.equal(
    await page.evaluate((element) => element.isConnected, frame),
    true,
    "board must reuse the existing shell renderer",
  );
  assert.equal(
    await page.getByTestId("tool-terminal").getAttribute("data-cwd"),
    "/synthetic/trees/board/project",
  );
  assert.deepEqual(
    await page.evaluate(() =>
      [
        "onOpenBrowserUrl",
        "onOpenCodeViewer",
        "onOpenFileLink",
        "onOpenBackgroundBash",
        "onOpenSubagentSession",
        "onOpenSubagentDirectory",
        "onOpenSelectionSideChat",
        "onOpenPlanDetail",
        "onOpenWorkflowRun",
        "onOpenWorkflowArtifact",
        "onOpenWorkflowActorSession",
        "onOpenWorkflowWorkspace",
      ].filter((key) => typeof window.__tools.boardOptions[key] !== "function"),
    ),
    [],
  );
  await page.evaluate(() => window.__tools.desktop(false));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("shell-board").waitFor({ state: "hidden" });
  const mobileSide = await side.boundingBox();
  assert.ok(
    mobileSide.width >= 380 && mobileSide.x >= 0,
    "real shell board tools fill the mobile width",
  );
  await page.getByTestId("browser").getByTestId("side-pane-toggle").click();
  await page.getByTestId("shell-board").waitFor({ state: "visible" });
  await frame.dispose();
}

export async function assertWorkTaskHeaderActions(headerLocator) {
  assert.equal(await headerLocator.getByTestId("workspace-help-menu-trigger").count(), 0);
  await headerLocator.page().waitForFunction(() => {
    const header = document.querySelector('[data-testid="work-task-content"] > header');
    const actions = header?.querySelector('[data-testid="work-task-header-actions"]');
    if (!header || !actions) return false;
    return (
      Math.abs(header.getBoundingClientRect().right - actions.getBoundingClientRect().right - 12) <
      2
    );
  });
  assert.equal(
    await headerLocator
      .getByTestId("work-task-header-actions")
      .getByTestId("work-task-workspace-tools")
      .count(),
    1,
  );
}
