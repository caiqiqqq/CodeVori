// Real shared panel/editor, isolated fake Host. No real agent, user config, or paid request.
// Run against the desktop Vite server: node packages/ui/test/agentDelegation.e2e.mjs
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { workTaskPromptAssetsFixture } from "./workTaskPromptAssetsFixture.mjs";
import { assertApiDelegationMentions } from "./delegationApiMentionAssertions.mjs";
import { assertDelegationSettings } from "./delegationSettingsAssertions.mjs";

const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__delegation-e2e-${process.pid}`;
const html = join(root, `${name}.html`);
const moduleFile = join(root, `${name}.tsx`);
const shots = await mkdtemp(join(tmpdir(), "zcode-delegation-ui-"));
let browser;
try {
  await Promise.all([
    writeFile(
      html,
      `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
    ),
    writeFile(
      moduleFile,
      `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { AgentDelegationPanel } from "../../../ui/src/delegation/AgentDelegationPanel.tsx";
      import { DelegationSettingsSection } from "../../../ui/src/settings/DelegationSettingsSection.tsx";
      import { AcpAgentsSection } from "../../../ui/src/settings/AcpAgentsSection.tsx";
      import { createSettingsPageConfig, resolveSettingsSectionForPlatform } from "../../../ui/src/settings/settingsPageConfig.ts";
      import { consumeInitialSettingsSection, setPendingSettingsSectionIntent, writeLastSettingsSectionPreference } from "../../../ui/src/lib/settingsNavigation.ts";
      import { useZCodeIntl } from "../../../ui/src/i18n/IntlProvider.tsx";
      import { ChatPromptEditor } from "../../../ui/src/prompt-editor/ChatPromptEditor.tsx";
      import { ConversationUserInputContent } from "../../../ui/src/v4/ConversationUserInputContent.tsx";
      import { useAgentDelegation } from "../../../ui/src/hooks/useAgentDelegation.ts";
      import { listenWorktreeSettingsConversation } from "../../../ui/src/lib/worktreeSettingsNavigation.ts";
      import { ServiceProvider } from "../../../ui/src/hooks/useServices.tsx";
      import { TabStoreProvider } from "../../../ui/src/store/TabStoreProvider.tsx";
      import { PlatformProvider } from "../../../ui/src/hooks/usePlatform.tsx";
      import { ZCodeIntlProvider } from "../../../ui/src/i18n/IntlProvider.tsx";
      import { TooltipProvider } from "../../../ui/src/components/ui/tooltip.tsx";
      import { getDelegationAgentReference, delegationSettingsSchema } from "@zcode/shared";
      import { connectProviderSettingsSnapshot } from "../../../ui/src/lib/providerSettingsSnapshot.ts";
      import "../../../ui/src/styles.css";
      const clone = value => structuredClone(value);
      const state = window.__delegation = { calls: [], sent: [], settings: { concurrency: 2, maxDepth: 2, allowNested: false }, rows: [], kind: 'acp' };
      const apiTarget = providerId => ({ kind: 'api', providerName: providerId === 'api-provider' ? '测试 API' : '第二 API', execution: { kind: 'api', modelSelection: { providerId, modelId: 'model/中文 v2', options: { reasoningLevel: 'high' } }, mode: 'build' }, reasoningLevels: ['low', 'high'] });
      state.apiReference = getDelegationAgentReference(apiTarget('api-provider'));
      const callbacks = new Set();
      const changed = () => callbacks.forEach(fn => fn());
      const result = { conclusion: '**委派结果**\\n已核对接口', changedFiles: ['src/main.ts'], tests: ['fixture test'], risks: ['未调用真实模型'], blockers: [], structured: true };
      const initial = kind => ({ id: crypto.randomUUID(), requestId: crypto.randomUUID(), parent: { workspacePath: '/synthetic/project', kind, sessionId: kind + '-parent' }, title: kind.toUpperCase() + ' 子任务', execution: { kind: 'acp', agent: 'codex', config: [] }, intent: 'analysis', status: 'failed', session: { kind: 'acp', id: kind + '-child' }, attempts: [{ sequence: 1, commandId: crypto.randomUUID(), status: 'failed', endedAt: 1, error: 'work-task.not-repository', result, delivery: 'uncertain' }] });
      state.seed = () => { state.rows.push(initial('acp'), initial('api')); changed(); };
      state.clear = () => { state.rows.length = 0; state.calls.length = 0; changed(); };
      const delegation = {
        targets: async () => [{ agent: 'codex', enabled: true, ready: true }, { agent: 'claude', enabled: true, ready: true }, apiTarget('api-provider'), apiTarget('second-provider')],
        list: async parent => clone(state.rows.filter(task => task.parent.kind === parent.kind && task.parent.sessionId === parent.sessionId)),
        onDynamicChanged: () => fn => { callbacks.add(fn); return { dispose: () => callbacks.delete(fn) }; },
        delegate: async input => { state.calls.push({ op: 'delegate', ...clone(input) }); if (state.rejectNext) { state.rejectNext = false; throw new Error('delegation.agent-unavailable'); } state.rows.push({ ...clone(input), id: crypto.randomUUID(), parent: { workspacePath: input.workspacePath, kind: input.kind, sessionId: input.sessionId }, status: 'queued', attempts: [] }); changed(); if (state.holdNext) { state.holdNext = false; await new Promise(resolve => state.resolveHeld = resolve); state.heldFinished = true; } },
        followUp: async input => { state.calls.push({ op: 'follow-up', ...clone(input) }); },
        retry: async input => { state.calls.push({ op: 'retry', ...input }); const task = state.rows.find(t => t.id === input.id); task.status = 'running'; task.attempts.push({ sequence: 2, status: 'running' }); changed(); },
        cancel: async input => { state.calls.push({ op: 'cancel', ...input }); state.rows.find(t => t.id === input.id).status = 'canceled'; changed(); },
        cancelAll: async input => { state.calls.push({ op: 'cancel-all', ...input }); state.rows.filter(t => t.parent.kind === input.kind).forEach(t => t.status = 'canceled'); changed(); },
        redeliver: async input => { state.calls.push({ op: 'redeliver', ...input }); state.rows.find(t => t.id === input.id).attempts.find(a => a.sequence === input.attemptSequence).delivery = 'delivered'; changed(); },
        getSettings: async () => clone(state.settings),
        updateSettings: async input => { const next = delegationSettingsSchema.parse({ enabled: input.enabled, concurrency: input.concurrency, allowNested: input.allowNested, maxDepth: input.maxDepth, completedCacheMaxMb: input.completedCacheMaxMb }); state.calls.push({ op: 'settings', ...input }); if (state.rejectNextSettings) { state.rejectNextSettings = false; throw new Error('delegation.nesting-capacity'); } if (state.holdNextSettings) { state.holdNextSettings = false; await new Promise(resolve => state.resolveSettings = resolve); } state.settings = next; },
      };
      const service = {};
      const services = { workTaskService: service, agentDelegationService: delegation };
      const providerView = { revision: 1, providers: ['api-provider', 'second-provider'].map(providerId => ({ providerId, effectiveConfig: { logo: { type: 'builtin', key: providerId === 'api-provider' ? 'bigmodel' : 'anthropic' } } })), providerOrder: [], providerTemplates: [] };
      services.providerSettingsService = { getView: async () => providerView, onDidChange: () => ({ dispose() {} }) };
      connectProviderSettingsSnapshot(services.providerSettingsService);
      const platform = { isMacOS: false, isWindows: false, isLinux: true, isWeb: true, selectDirectory: async () => null };
      ${workTaskPromptAssetsFixture}
      services.clientConfigService = { getSnapshot: async () => ({ pluginStoreOrder: null }) };
      services.pluginManagementService = { getPluginReferenceCatalog: async input => ({ plugins: [], authority: input.sessionId ? 'session' : 'workspace' }) };
      services.acpService = { listAgents: async () => [], listPlugins: async () => [], read: async input => ({ id: input.id, workspacePath: input.workspacePath, agent: 'codex', title: '子会话', entries: [{ id: 'user:first', kind: 'user', text: '测试任务', createdAt: 1 }], status: 'idle', createdAt: 1, updatedAt: 1 }) };
      services.subagentsService = { list: async () => [] };
      services.zcodeSessionService = { list: async () => [] };
      services.skillsService = { list: async () => ({ skills: [], diagnostics: [], capability: { userScopeAvailable: true } }) };
      services.zcodeAgentService = { onAgentRuntimeRestarted: () => ({ dispose() {} }), onDynamicSessionsIndexFrame: () => () => ({ dispose() {} }), onAgentRuntimeLifecycleChanged: () => ({ dispose() {} }) };
      listenWorktreeSettingsConversation(target => { state.navigation = target; });
      function Fixture() {
        const [kind, setKind] = useState('acp');
        const [sentText, setSentText] = useState('');
        const [view, setView] = useState('session');
        const [settingsKey, setSettingsKey] = useState(0);
        const [settingsSection, setSettingsSection] = useState('delegation');
        const { intl } = useZCodeIntl();
        const sections = createSettingsPageConfig().settingsSections.filter(section => ['delegation', 'acpAgents'].includes(section.id));
        const currentSection = sections.find(section => section.id === settingsSection)!;
        const openSettings = section => { writeLastSettingsSectionPreference(section); setSettingsSection(section); };
        state.reopenSettings = () => { openSettings(resolveSettingsSectionForPlatform(consumeInitialSettingsSection(), sections)); setSettingsKey(key => key + 1); };
        state.openSettingsIntent = section => { setPendingSettingsSectionIntent(section); state.reopenSettings(); };
        state.remountSettings = () => setSettingsKey(key => key + 1);
        const parent = { workspacePath: '/synthetic/project', kind, sessionId: view === 'draft' ? '' : kind + '-parent' };
        const delegation = useAgentDelegation(parent as never, view !== 'readonly');
        state.available = delegation.available;
        state.setView = setView;
        state.switchKind = () => { const next = kind === 'acp' ? 'api' : 'acp'; state.kind = next; setKind(next); };
        return <main className="mx-auto w-full max-w-3xl bg-background p-3 text-foreground">
          <button data-testid="switch" onClick={state.switchKind}>切换会话</button>
          <div className="my-3 text-ui-base" data-testid="original-conversation">原会话 · {kind.toUpperCase()}</div>
          <AgentDelegationPanel key={kind} parent={parent as never} controller={delegation} />
          <ChatPromptEditor workspacePath={parent.workspacePath} taskId={kind === 'api' ? parent.sessionId || null : null} acpMode={kind === 'acp'} acpAgent={kind === 'acp' ? 'codex' : null} acpSessionId={kind === 'acp' ? parent.sessionId || null : null}
            showMentionButton enableMentionPanel onDelegateTask={delegation.available ? () => delegation.openEditor('new') : undefined}
            attachmentAction={{ label: '上传主附件', onSelect: () => state.calls.push({ op: 'main-attachment' }) }}
            inputTestId="main-input" submitLabel="发送主消息" onSubmit={value => { state.sent.push(value); setSentText(value); return false; }} />
          <div data-testid="sent-user-message"><ConversationUserInputContent text={sentText} /></div>
          <div className="mt-8" data-testid="delegation-settings-section" data-section={settingsSection}>
            <nav className="mb-4 flex flex-wrap gap-3 text-ui-base" data-testid="delegation-settings-navigation">
              {sections.map(({id, titleId, icon: Icon}) => <button key={id} aria-current={settingsSection === id ? 'page' : undefined} onClick={() => openSettings(id)} className="flex items-center gap-2"><Icon className="size-4" aria-hidden />{intl.formatMessage({id: titleId})}</button>)}
            </nav>
            <h2 className="mb-4 text-ui-base font-medium">{intl.formatMessage({id: currentSection.titleId})}</h2>
            {settingsSection === 'delegation' ? <DelegationSettingsSection key={settingsKey} workspacePath={parent.workspacePath} /> : <AcpAgentsSection workspacePath={parent.workspacePath} />}
          </div>
        </main>;
      }
      createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
    `,
    ),
  ]);
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://localhost:5174"}/${name}.html`);
    const panel = page.getByTestId("delegation-panel");
    const main = page.getByTestId("main-input");
    await main.waitFor({ timeout: 15000 });
    const openDelegation = async (keyboard = false) => {
      await page.getByRole("button", { name: "添加上下文", exact: true }).click();
      const option = page.getByRole("option", { name: "委派任务", exact: true });
      await option.waitFor({ timeout: 10000 }).catch(async (error) => {
        throw new Error(
          `${error.message}\n${JSON.stringify(await page.evaluate(() => ({ available: window.__delegation.available, menu: document.querySelector('[data-trigger="+"]')?.textContent, options: [...document.querySelectorAll('[role="option"]')].map((el) => ({ text: el.textContent, disabled: el.getAttribute("aria-disabled") })) })))}\n${errors.join("\n")}`,
        );
      });
      if (keyboard) {
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
      } else {
        await option.click();
      }
      const dialog = page.getByRole("dialog", { name: "委派任务", exact: true });
      await dialog.waitFor();
      await page.locator('[data-trigger="+"]').waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"]'));
      return dialog;
    };
    for (const view of ["draft", "readonly"]) {
      await page.evaluate((value) => window.__delegation.setView(value), view);
      await page.waitForFunction(() => !window.__delegation.available);
      await page.getByRole("button", { name: "添加上下文", exact: true }).click();
      await page.getByRole("option", { name: "上传主附件", exact: true }).waitFor();
      assert.equal(await page.getByRole("option", { name: "委派任务", exact: true }).count(), 0);
      assert.equal(await panel.count(), 0, `${view} has no delegation panel`);
      await page.keyboard.press("Escape");
      await page.locator('[data-trigger="+"]').waitFor({ state: "hidden" });
    }
    await page.evaluate(() => window.__delegation.setView("session"));
    await page.waitForFunction(() => window.__delegation.available);
    for (const kind of ["acp", "api"]) {
      assert.equal(await panel.count(), 0, `empty ${kind} list leaves no panel`);
      await main.fill(`${kind} 主会话草稿`);
      let dialog = await openDelegation(kind === "acp");
      assert.equal(await panel.count(), 0, "manual editor does not create an empty status panel");
      await dialog.getByTestId("work-task-prompt").fill("临时委派草稿");
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await panel.count(), 0);
      assert.equal(await main.innerText(), `${kind} 主会话草稿`);
      assert.equal(
        await page.evaluate(
          () =>
            window.__delegation.calls.filter((c) => c.op === "delegate" || c.op === "follow-up")
              .length,
        ),
        0,
      );
      dialog = await openDelegation();
      const apiReference = await page.evaluate(() => window.__delegation.apiReference);
      await dialog.getByLabel("选择智能体").selectOption(apiReference);
      assert.match(await dialog.getByLabel("选择智能体").innerText(), /model\/中文 v2.*测试 API/);
      assert.match(await dialog.getByLabel("选择智能体").innerText(), /model\/中文 v2.*第二 API/);
      assert.equal(
        await page.evaluate(
          () => window.__delegation.calls.filter((c) => c.op === "delegate").length,
        ),
        0,
      );
      await dialog.getByLabel("任务类型").selectOption("analysis");
      await dialog.getByTestId("work-task-prompt").fill(`${kind} 首个委派任务`);
      if (kind === "acp") {
        await page.evaluate(() => {
          window.__delegation.rejectNext = true;
        });
        await dialog.getByRole("button", { name: "发送", exact: true }).click();
        await dialog.getByRole("alert").filter({ hasText: "该智能体未安装或未启用" }).waitFor();
        assert.equal(await panel.count(), 0, "failed admission leaves no empty panel");
      }
      await dialog.getByRole("button", { name: "发送", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await panel.waitFor();
      assert.equal(await panel.getAttribute("data-main-kind"), kind);
      assert.equal(await main.innerText(), `${kind} 主会话草稿`);
      const first = await page.evaluate(() =>
        window.__delegation.calls.find((c) => c.op === "delegate"),
      );
      assert.equal(first.kind, kind);
      assert.equal(first.sessionId, `${kind}-parent`);
      assert.deepEqual(first.execution, {
        kind: "api",
        modelSelection: {
          providerId: "api-provider",
          modelId: "model/中文 v2",
          options: { reasoningLevel: "high" },
        },
        mode: "build",
      });
      await page.evaluate(() => window.__delegation.clear());
      await panel.waitFor({ state: "hidden" });
      dialog = await openDelegation();
      assert.equal((await dialog.getByTestId("work-task-prompt").innerText()).trim(), "");
      await dialog.getByTestId("work-task-prompt").fill("不能留到下一会话");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `dialog overflow at ${width}px`,
      );
      await page.screenshot({ path: join(shots, `empty-${kind}-${width}.png`), fullPage: true });
      await page.evaluate(() => window.__delegation.switchKind());
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await panel.count(), 0, "session switch never leaves an old editor or panel");
    }
    await page.evaluate(() => {
      window.__delegation.holdNext = true;
    });
    let heldDialog = await openDelegation();
    await heldDialog.getByTestId("work-task-prompt").fill("旧 ACP 会话的延迟提交");
    await heldDialog.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(() => typeof window.__delegation.resolveHeld === "function");
    await page.evaluate(() => window.__delegation.switchKind());
    await heldDialog.waitFor({ state: "hidden" });
    const nextDialog = await openDelegation();
    await nextDialog.getByTestId("work-task-prompt").fill("新 API 会话的委派草稿");
    await page.evaluate(() => window.__delegation.resolveHeld());
    await page.waitForFunction(() => window.__delegation.heldFinished);
    assert.equal(await nextDialog.isVisible(), true, "old completion never closes a new dialog");
    assert.equal(
      await nextDialog.getByTestId("work-task-prompt").innerText(),
      "新 API 会话的委派草稿",
    );
    await nextDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await nextDialog.waitFor({ state: "hidden" });
    await page.evaluate(() => {
      window.__delegation.clear();
      window.__delegation.switchKind();
    });
    await page.evaluate(() => window.__delegation.seed());
    await panel.waitFor({ timeout: 15000 }).catch((error) => {
      throw new Error(`${error.message}\n${errors.join("\n")}`);
    });
    assert.equal(await panel.getAttribute("data-main-kind"), "acp");
    assert.equal(await panel.getByRole("button", { name: "委派任务", exact: true }).count(), 0);
    await panel.getByRole("button", { name: /智能体委派/ }).click();
    const row = panel.getByTestId("delegation-task").first();
    await row.waitFor();
    assert.match(await row.textContent(), /ACP 子任务/);
    await row.locator('[data-testid^="tool-summary-trigger-"]').click();
    assert.match(await row.textContent(), /项目不是 Git 仓库/);
    assert.ok(!(await row.textContent()).includes("work-task.not-repository"));
    await row.locator("summary").click();
    assert.ok((await row.textContent()).includes("fixture test"));
    await row.getByRole("button", { name: "重新回传结果" }).click();
    await page.waitForFunction(() =>
      window.__delegation.calls.some(
        (call) => call.op === "redeliver" && call.attemptSequence === 1,
      ),
    );
    await row.getByRole("button", { name: "打开子会话" }).click();
    await page.waitForFunction(() => window.__delegation.navigation?.session.id === "acp-child");
    await row.getByRole("button", { name: "追问", exact: true }).click();
    const followUp = page.getByRole("dialog", { name: "追问", exact: true });
    await followUp.getByTestId("work-task-prompt").fill("复核已有结果");
    await followUp.getByTestId("work-task-file-input").setInputFiles({
      name: "follow.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("follow evidence"),
    });
    await followUp.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(() =>
      window.__delegation.calls.some(
        (call) => call.op === "follow-up" && call.attachments.length === 1,
      ),
    );
    await row.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="delegation-task"]')?.getAttribute("data-status") ===
        "running",
    );
    await row.getByRole("button", { name: "取消任务" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="delegation-task"]')?.getAttribute("data-status") ===
        "canceled",
    );
    const dialog = await openDelegation();
    await dialog.getByLabel("选择智能体").selectOption("acp.claude");
    await dialog.getByLabel("任务类型").selectOption("analysis");
    const input = dialog.getByTestId("work-task-prompt");
    await input.fill("调查 @main");
    const file = page
      .locator('[data-trigger="@"] [data-section-id="files"][role="option"]')
      .filter({ hasText: "main.ts" });
    await file.waitFor();
    await file.click();
    await dialog.getByTestId("work-task-file-input").setInputFiles({
      name: "task.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("task evidence"),
    });
    await dialog.getByTestId("work-task-attachment").waitFor();
    await dialog.getByRole("button", { name: "发送", exact: true }).click();
    await page.waitForFunction(() =>
      window.__delegation.calls.some((call) => call.op === "delegate"),
    );
    const submitted = await page.evaluate(() =>
      window.__delegation.calls.find((call) => call.op === "delegate"),
    );
    assert.equal(submitted.execution.agent, "claude");
    assert.equal(submitted.intent, "analysis");
    assert.deepEqual(submitted.workspaceFiles, ["src/main.ts"]);
    assert.equal(submitted.attachments[0].fileName, "task.txt");
    assert.equal(submitted.sessionId, "acp-parent");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await main.innerText(), "api 主会话草稿", "delegation preserves the main draft");
    await main.fill("@Claude");
    const target = page
      .locator('[data-trigger="@"] [data-section-id="delegation"][role="option"]')
      .filter({ hasText: "Claude" });
    await target.waitFor();
    assert.equal(await target.locator('[data-acp-agent-icon="claude"]').count(), 1);
    assert.equal(
      await page.locator('[data-section-id="delegation"] [data-acp-agent-icon="codex"]').count(),
      1,
    );
    assert.equal(
      await page.locator('[data-section-id="delegation"]').filter({ hasText: "Qoder" }).count(),
      0,
    );
    await target.click();
    const acpChip = main.locator('[data-mention-category="subagents"]');
    assert.equal(await acpChip.innerText(), "Claude ACP");
    const acpColor = await acpChip.evaluate((element) => getComputedStyle(element).color);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__delegation.sent.length === 1);
    const sentAcpChip = page.getByTestId("sent-user-message").locator("span").first();
    assert.equal(await sentAcpChip.innerText(), "Claude ACP");
    assert.equal(await sentAcpChip.locator("svg.lucide-bot").count(), 1);
    assert.equal(
      await sentAcpChip.evaluate((element) => getComputedStyle(element).color),
      acpColor,
    );
    assert.match(await page.evaluate(() => window.__delegation.sent[0]), /@acp\.claude/);
    assert.equal(
      await page.evaluate(() => window.__delegation.kind),
      "acp",
      "mention never switches main agent",
    );
    await assertApiDelegationMentions(page, main, shots, width);
    await assertDelegationSettings(page, shots, width);
    await page.screenshot({ path: join(shots, `acp-${width}.png`), fullPage: true });
    await page.getByTestId("switch").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="delegation-panel"]')
          ?.getAttribute("data-main-kind") === "api",
    );
    await panel.getByRole("button", { name: /智能体委派/ }).click();
    assert.ok((await panel.textContent()).includes("API 子任务"));
    assert.ok(!(await panel.textContent()).includes("ACP 子任务"));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `horizontal overflow at ${width}px`,
    );
    await page.screenshot({ path: join(shots, `api-${width}.png`), fullPage: true });
    assert.deepEqual(errors, [], `browser errors at ${width}px`);
    await page.close();
  }
  process.stdout.write(
    `PASS delegation empty API/ACP views, + menu dialogs, scoped drafts, attempts/actions, attachment/file editor, @target, settings at 1280/375px. Screenshots: ${shots}\n`,
  );
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
