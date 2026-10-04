// Run against an open local Git workspace in ZCode Dev:
// node packages/ui/test/worktreeCreation.e2e.mjs
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workspaceServiceStoreModule = `/@fs/${fileURLToPath(
  new URL("../src/store/remoteWorkspaceSessionStore.ts", import.meta.url),
)
  .replaceAll("\\", "/")
  .replace(/^\//, "")}`;
const browser = await chromium.connectOverCDP(
  process.env.ZCODE_E2E_CDP_URL || "http://127.0.0.1:9229",
);

try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes(":5174/"));
  assert.ok(page, "ZCode Dev renderer must be running on port 5174");
  await page.waitForFunction(
    async (storeModuleUrl) => {
      const { useRemoteWorkspaceSessionStore } = await import(/* @vite-ignore */ storeModuleUrl);
      return Boolean(useRemoteWorkspaceSessionStore.getState().baseServices);
    },
    workspaceServiceStoreModule,
    { timeout: 30_000 },
  );

  // 真正走 Renderer → window Host 的 RPC；旧 Host 会抛 Method not found。
  // 使用不存在的仓库，验证接口存在而不创建分支或目录。
  const rpcResult = await page.evaluate(
    async ({ storeModuleUrl, missingWorkspacePath, unusedWorktreeRootPath }) => {
      const { useRemoteWorkspaceSessionStore } = await import(/* @vite-ignore */ storeModuleUrl);
      const services = useRemoteWorkspaceSessionStore.getState().baseServices;
      if (!services) throw new Error("Desktop local Host services are not connected");
      return await services.gitService.createAutomaticWorktree({
        workspacePath: missingWorkspacePath,
        worktreeRootPath: unusedWorktreeRootPath,
      });
    },
    {
      storeModuleUrl: workspaceServiceStoreModule,
      missingWorkspacePath: join(tmpdir(), "__zcode_worktree_e2e_missing_repository__"),
      unusedWorktreeRootPath: join(tmpdir(), "__zcode_worktree_e2e_unused_root__"),
    },
  );
  assert.equal(rpcResult.ok, false);
  assert.equal(rpcResult.issues[0]?.code, "not-repository");

  const branchTrigger = page
    .getByRole("button", { name: /^(切换 Git 分支|Switch Git branch)$/ })
    .first();
  assert.equal(await branchTrigger.count(), 1, "Open a local Git workspace before this scenario");
  await branchTrigger.click();
  await page.getByRole("button", { name: /^(新建工作树|New worktree)$/ }).click();
  assert.equal(
    await page.getByRole("dialog", { name: /^(创建工作树|Create worktree)$/ }).count(),
    0,
  );
  assert.equal(await page.getByTestId("worktree-draft-selected").count(), 1);
  await page
    .getByRole("button", { name: /^(切换 Git 分支|Switch Git branch)$/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^(取消新建工作树|Cancel new worktree)$/ }).click();
  assert.equal(await page.getByTestId("worktree-draft-selected").count(), 0);

  process.stdout.write(
    "PASS: Worktree draft selection shows inline without creating or opening a dialog.\n",
  );
} finally {
  await browser.close();
}
