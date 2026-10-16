// Run with the desktop Vite dev server on 5174. Fake UI Host; no paid model requests.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__acp-workflow-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, { useMemo, useState } from "react";
      import { createRoot } from "react-dom/client";
      import { ChatPromptEditor } from "../../../ui/src/prompt-editor/ChatPromptEditor.tsx";
      import { ConversationRowView } from "../../../ui/src/v4/ConversationRowView.tsx";
      import { AcpConversationStatus } from "../../../ui/src/v4/AcpConversationContent.tsx";
      import { buildAcpConversationRows } from "../../../ui/src/v4/acpConversationRows.ts";
      import { buildWorkflowRunByToolCallId } from "../../../ui/src/v4/workflowRunCardJoin.ts";
      import { ServiceProvider } from "../../../ui/src/hooks/useServices.tsx";
      import { TabStoreProvider } from "../../../ui/src/store/TabStoreProvider.tsx";
      import { PlatformProvider } from "../../../ui/src/hooks/usePlatform.tsx";
      import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
      import { TooltipProvider } from "../../../ui/src/components/ui/tooltip.tsx";
      import { useDynamicWorkflowAvailabilityLoader } from "../../../ui/src/hooks/useDynamicWorkflowAvailability.ts";
      import { resolveDynamicWorkflowClientConfig } from "../../../shared/src/dynamic-workflow-feature.ts";
      import "../../../ui/src/styles.css";
      window.__sent = [];
      window.__actions = [];
      const workflowPolicy = { getDynamicWorkflowClientConfig: async () => resolveDynamicWorkflowClientConfig({env: new URLSearchParams(location.search).has('disabled') ? { ZCODE_DYNAMIC_WORKFLOW_MODE: 'disabled' } : {}}) };
      const services = {
        clientConfigService: { getSnapshot: async () => ({ pluginStoreOrder: null }) },
        fileService: { searchWorkspaceFiles: async () => [] },
        acpService: { listPlugins: async () => [] },
        subagentsService: { list: async () => [] },
        zcodeSessionService: { list: async () => [] },
        skillsService: { list: async () => ({ skills: [], diagnostics: [], capability: { userScopeAvailable: true } }) },
        zcodeAgentService: { onAgentRuntimeRestarted: () => ({ dispose() {} }), onDynamicSessionsIndexFrame: () => () => ({ dispose() {} }), onAgentRuntimeLifecycleChanged: () => ({ dispose() {} }) },
      };
      const platform = { isMacOS: false, isWindows: false, isLinux: true, isWeb: true, selectDirectory: async () => null };
      const graph = { steps: [{ id: 'ask#1', kind: 'ask', label: '研究', lane: 'actor#1', phase: 'phase#1' }],
        lanes: [{ id: 'actor#1', name: '研究员' }], participants: [{ id: 'phase#1:actor#1', phase: 'phase#1', lane: 'actor#1', steps: ['ask#1'] }], handoffs: [],
        phases: [{ id: 'phase#1', name: '调查' }], phaseEdges: [], exits: ['phase#1'] };
      function Fixture() {
        useDynamicWorkflowAvailabilityLoader(workflowPolicy);
        const [status, setStatus] = useState('running');
        const [acp, setAcp] = useState(true);
        const entries = [{ id: 'user:one', kind: 'user', text: '/workflow 查找线索', createdAt: 1 },
          { id: 'tool:workflow:acp-workflow-12345678-1234-1234-1234-123456789abc', kind: 'tool', title: '调查工作流', status: status === 'running' ? 'in_progress' : 'cancelled', createdAt: 2,
            workflow: { runId: 'acp-workflow-12345678-1234-1234-1234-123456789abc', name: '调查工作流', graph } }];
        const runs = [{ runId: entries[1].workflow.runId, toolCallId: entries[1].id, status, usage: { spentTokens: 10, nodesUsed: 1 },
          artifacts: [{ id: 'report', kind: 'markdown', title: '报告', version: 1, contentType: 'text/markdown' }],
          actors: [{ siteId: 'actor#1', ordinal: 1, name: '研究员', status: status === 'running' ? 'running' : 'completed' }],
          nodes: [{ siteId: 'ask#1', ordinal: 1, kind: 'ask', phase: status === 'running' ? 'running' : 'settled', actorSiteId: 'actor#1', actorOrdinal: 1 }],
          phases: [{ name: '调查', rounds: 1 }], currentPhase: '调查', lastEventSequence: 1,
          ...(status === 'stopped' ? { resumable: true, stopReason: 'user' } : {}) }];
        const rows = buildAcpConversationRows({ entries, status: 'idle' });
        const context = { workspacePath: '/test', workflowRunByToolCallId: buildWorkflowRunByToolCallId(runs),
          onCancelBackgroundWork: () => { window.__actions.push('stop'); setStatus('stopped'); },
          onResumeWorkflowRun: () => { window.__actions.push('resume'); setStatus('running'); },
          onOpenAcpWorkflowArtifact: (_runId, artifactId) => window.__actions.push('open:' + artifactId) };
        return <><button data-testid="switch" onClick={() => setAcp(!acp)}>切换模型</button>
          <main style={{ width: 'min(700px, 100vw)', margin: '30px auto' }}>
            <ChatPromptEditor workspacePath="/test" taskId="native-session" acpMode={acp} acpAgent={acp ? 'codex' : null}
              acpSessionId={acp ? 'acp-session' : null} enableMentionPanel enableSlashCommands={!acp}
              attachmentAction={{ label: '添加附件', onSelect: () => {} }} inputTestId="v4-composer-input" submitLabel="发送"
              onSubmit={(value) => { window.__sent.push(value); return false; }} />
            <div data-testid="original-user">{entries[0].text}</div>
            <AcpConversationStatus agent="codex" conversation={{ selected: { pendingPermission: {
              requestId: 'review', title: '启动工作流？\\n' + '脚本内容\\n'.repeat(400) + 'REVIEW_END',
              options: [{ optionId: 'allow', name: '允许', kind: 'allow_once' }],
            } }, error: null, busy: false, decide: () => window.__actions.push('allow') } as never} />
            {rows.filter(row => row.kind === 'toolCall').map(row => <ConversationRowView key={row.rowId} row={row} context={context as never} />)}
          </main></>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(`http://localhost:5174/${name}.html`);
    const input = page.getByTestId("v4-composer-input");
    await input.waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "添加上下文" }).click();
    const workflow = page
      .locator('[data-trigger="+"] [data-section-id="add"][role="option"]')
      .filter({ hasText: "工作流" });
    await workflow.waitFor();
    assert.equal(await workflow.getAttribute("aria-disabled"), "false");
    await workflow.click();
    await input.press("End");
    await page.keyboard.type("查找线索");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__sent.length === 1);
    assert.match((await page.evaluate(() => window.__sent[0])).trim(), /^\/workflow\s+查找线索/);
    assert.equal(await page.getByTestId("original-user").textContent(), "/workflow 查找线索");
    const permission = page.getByTestId("acp-permission");
    assert.equal(
      await permission.locator("p").evaluate((node) => node.scrollHeight > node.clientHeight),
      true,
    );
    assert.ok((await permission.textContent()).includes("REVIEW_END"));
    await permission.getByRole("button", { name: "允许" }).click();
    const card = page.locator('[data-workflow-run-digest="true"]');
    await card.waitFor();
    assert.equal(await card.getAttribute("data-workflow-run-status"), "running");
    assert.ok((await card.textContent()).includes("调查工作流"));
    await card.getByTestId("workflow-digest-artifact").click();
    await page.waitForFunction(() => window.__actions.includes("open:report"));
    await card.getByTestId("workflow-digest-cancel").click();
    await page.waitForFunction(() => window.__actions.includes("stop"));
    assert.equal(await card.getAttribute("data-workflow-run-status"), "stopped");
    await card.getByTestId("workflow-digest-resume").click();
    assert.deepEqual(await page.evaluate(() => window.__actions), [
      "allow",
      "open:report",
      "stop",
      "resume",
    ]);
    assert.deepEqual(errors, [], `Browser errors at ${width}px`);
    await page.close();
  }
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`http://localhost:5174/${name}.html?disabled`);
    await page.getByTestId("v4-composer-input").waitFor();
    await page.getByRole("button", { name: "添加上下文" }).click();
    await page
      .locator('[data-trigger="+"] [data-section-id="add"][role="option"]')
      .first()
      .waitFor();
    assert.equal(
      await page
        .locator('[data-trigger="+"] [data-section-id="add"][role="option"]')
        .filter({ hasText: "工作流" })
        .count(),
      0,
    );
    await page.close();
  }
  process.stdout.write(
    "PASS ACP editor, workflow menu enabled/disabled, full-script permission, artifact, digest stop/resume at 1280/375px.\n",
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
