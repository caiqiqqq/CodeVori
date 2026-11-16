// Real settings and composer against a disposable fake Host. Never calls a model.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { workTaskPromptAssetsFixture } from "./workTaskPromptAssetsFixture.mjs";
const root = new URL("../../desktop/src/renderer/", import.meta.url).pathname;
const name = `__squads-e2e-${process.pid}`;
const html = join(root, `${name}.html`),
  moduleFile = join(root, `${name}.tsx`);
const shots = await mkdtemp(join(tmpdir(), "zcode-squads-ui-"));
let browser;
try {
  await writeFile(
    html,
    `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><div id="root"></div><script type="module" src="./${name}.tsx"></script></html>`,
  );
  await writeFile(
    moduleFile,
    `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AgentSquadsSection } from '../../../ui/src/settings/AgentSquadsSection.tsx';
    import { createSettingsPageConfig } from '../../../ui/src/settings/settingsPageConfig.ts';
    import { ChatPromptEditor } from '../../../ui/src/prompt-editor/ChatPromptEditor.tsx';
    import { ConversationUserInputContent } from '../../../ui/src/v4/ConversationUserInputContent.tsx';
    import { ServiceProvider } from '../../../ui/src/hooks/useServices.tsx';
    import { TabStoreProvider } from '../../../ui/src/store/TabStoreProvider.tsx';
    import { PlatformProvider } from '../../../ui/src/hooks/usePlatform.tsx';
    import { ZCodeIntlProvider, useZCodeIntl } from '../../../ui/src/i18n/IntlProvider.tsx';
    import { TooltipProvider } from '../../../ui/src/components/ui/tooltip.tsx';
    import { agentSquadSaveSchema } from '@zcode/shared';
    import '../../../ui/src/styles.css';
    const clone = value => structuredClone(value);
    const state = window.__squads = { rows: [], calls: [], sent: [], noTargets: false };
    const callbacks = new Set();
    const changed = () => callbacks.forEach(fn => fn());
    const delegation = {
      listSquads: async () => clone(state.rows),
      targets: async () => state.noTargets ? [] : [{ kind: 'acp', agent: 'codex', enabled: true, ready: true }, { kind: 'api', providerName: 'Fixture API', execution: { kind: 'api', mode: 'build', modelSelection: { providerId: 'fixture', modelId: 'review-model', options: { reasoningLevel: 'high' } } }, reasoningLevels: ['low', 'high'] }],
      onDynamicSquadsChanged: () => fn => { callbacks.add(fn); return { dispose: () => callbacks.delete(fn) }; },
      saveSquad: async raw => {
        const input = agentSquadSaveSchema.parse(raw);
        state.calls.push({ op: 'save', ...clone(input) });
        const current = state.rows.find(row => row.id === input.id);
        if (state.conflict || (current?.revision ?? 0) !== input.expectedRevision) { state.conflict = false; throw new Error('delegation.squad-conflict'); }
        const { expectedRevision, ...fields } = input;
        const row = { ...fields, revision: expectedRevision + 1, createdAt: current?.createdAt ?? Date.now(), updatedAt: Date.now() };
        state.rows = [...state.rows.filter(item => item.id !== row.id), row]; changed(); return clone(row);
      },
      deleteSquad: async input => { state.calls.push({ op: 'delete', ...clone(input) }); state.rows = state.rows.filter(row => row.id !== input.id); changed(); },
    };
    const service = {};
    const services = { workTaskService: service, agentDelegationService: delegation };
    const platform = { isMacOS: false, isWindows: false, isLinux: true, isWeb: true, selectDirectory: async () => null };
    ${workTaskPromptAssetsFixture}
    services.clientConfigService = { getSnapshot: async () => ({ pluginStoreOrder: null }) };
    services.pluginManagementService = { getPluginReferenceCatalog: async input => ({ plugins: [], authority: input.sessionId ? 'session' : 'workspace' }) };
    services.acpService = { listAgents: async () => [], listPlugins: async () => [] };
    services.subagentsService = { list: async () => [] };
    services.zcodeSessionService = { list: async () => [] };
    services.skillsService = { list: async () => ({ skills: [], diagnostics: [], capability: { userScopeAvailable: true } }) };
    services.zcodeAgentService = { onAgentRuntimeRestarted: () => ({ dispose() {} }), onDynamicSessionsIndexFrame: () => () => ({ dispose() {} }), onAgentRuntimeLifecycleChanged: () => ({ dispose() {} }) };
    function Fixture() {
      const { intl } = useZCodeIntl();
      const [section, setSection] = useState('general');
      const [kind, setKind] = useState('acp');
      const [key, setKey] = useState(0);
      const [remote, setRemote] = useState(false);
      state.setRemote = setRemote;
      const [sent, setSent] = useState('');
      state.remount = () => setKey(value => value + 1);
      state.switchKind = setKind;
      return <main data-kind={kind} className="mx-auto max-w-3xl space-y-4 bg-background p-4 text-foreground">
        <nav>{createSettingsPageConfig().settingsSections.filter(item => ['general','squads'].includes(item.id)).map(item => <button key={item.id} onClick={() => setSection(item.id)} className="p-2 text-ui-base">{intl.formatMessage({ id: item.titleId })}</button>)}</nav>
        {section === 'squads' ? <AgentSquadsSection key={key} workspacePath="/synthetic/project" remoteTarget={remote ? { kind: "ssh" } : undefined} /> : null}
        <ChatPromptEditor key={kind} workspacePath="/synthetic/project" taskId={kind === 'api' ? 'api-parent' : null} acpMode={kind === 'acp'} acpAgent={kind === 'acp' ? 'codex' : null} acpSessionId={kind === 'acp' ? 'acp-parent' : null}
          showMentionButton enableMentionPanel inputTestId="main-input" submitLabel="发送主消息" onSubmit={value => { state.sent.push(value); setSent(value); return true; }} />
        <div data-testid="sent-user-message"><ConversationUserInputContent text={sent} /></div>
      </main>;
    }
    createRoot(document.getElementById('root')!).render(<PlatformProvider platform={platform as never}><TabStoreProvider><ServiceProvider services={services as never}><ZCodeIntlProvider initialLocale="zh-CN"><TooltipProvider><Fixture /></TooltipProvider></ZCodeIntlProvider></ServiceProvider></TabStoreProvider></PlatformProvider>);
  `,
  );
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.goto(`${process.env.ZCODE_E2E_BASE_URL ?? "http://127.0.0.1:5189"}/${name}.html`);
    await page.getByRole("button", { name: "小队", exact: true }).click();
    const settings = page.getByTestId("squads-settings");
    await settings.getByText("还没有小队", { exact: true }).waitFor();
    await settings.getByRole("button", { name: "新建小队" }).click();
    let editor = page.getByTestId("squad-editor");
    await editor.getByLabel("小队名称", { exact: true }).fill("研发[小队]");
    await editor.getByLabel("职责", { exact: true }).nth(1).fill("核对实现与测试，只汇报证据");
    // Same-engine roles are allowed; choose an API executor for the member as well.
    await editor.getByLabel("执行智能体", { exact: true }).nth(1).click();
    await page.getByRole("option", { name: "review-model (Fixture API)", exact: true }).click();
    await editor.getByRole("button", { name: "添加成员" }).click();
    await editor.getByLabel("角色名称").nth(2).fill("测试员");
    await editor.getByLabel("职责", { exact: true }).nth(2).fill("检查验收场景");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(shots, `${width}-editor.png`), fullPage: true });
    await page.evaluate(() => {
      window.__squads.conflict = true;
    });
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await settings
      .getByRole("alert")
      .getByText(/小队已被更新/)
      .waitFor();
    assert.equal(await editor.getByLabel("小队名称").inputValue(), "研发[小队]");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByTestId("squad-row").waitFor();
    assert.equal(await page.evaluate(() => window.__squads.rows[0].members.length), 2);
    assert.equal(
      await page.evaluate(() => window.__squads.rows[0].members[0].execution.kind),
      "api",
    );
    await page.evaluate(() => window.__squads.remount());
    await settings.getByRole("button", { name: "编辑小队" }).click();
    editor = page.getByTestId("squad-editor");
    await editor.getByLabel("说明", { exact: true }).fill("前后端核对");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByTestId("squad-row").getByText("前后端核对").waitFor();
    assert.equal(await page.evaluate(() => window.__squads.rows[0].revision), 2);
    for (const kind of ["acp", "api"]) {
      await page.evaluate((kind) => window.__squads.switchKind(kind), kind);
      // 切换执行方式会重建编辑器，等待新输入框就绪，避免把内容填进旧节点。
      await page.locator(`main[data-kind="${kind}"]`).waitFor();
      const input = page.locator('[data-testid="main-input"][data-e2e-lexical-bridge="ready"]');
      await input.waitFor();
      await input.fill("@研发");
      await page.getByRole("option").filter({ hasText: "研发[小队]" }).click();
      assert.equal(
        await page.evaluate(() => window.__squads.calls.some((call) => call.op === "delegate")),
        false,
      );
      await page.getByRole("button", { name: "发送主消息", exact: true }).click();
      await page
        .getByTestId("sent-user-message")
        .getByText("研发[小队]", { exact: false })
        .waitFor();
      const { sent, id } = await page.evaluate(() => ({
        sent: window.__squads.sent.at(-1),
        id: window.__squads.rows[0].id,
      }));
      assert.ok(sent.includes(`delegation://squad.${id}`));
    }
    for (const theme of ["zai-light", "zai-dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.className = `theme-${theme}${theme === "zai-dark" ? " dark" : ""}`;
      }, theme);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: join(shots, `${width}-${theme}.png`), fullPage: true });
    }
    await settings.getByRole("button", { name: "删除小队", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "删除小队", exact: true })
      .click();
    await settings.getByText("还没有小队", { exact: true }).waitFor();
    await page.evaluate(() => {
      window.__squads.noTargets = true;
      window.__squads.remount();
    });
    await settings.getByText(/请先配置可用的 API/).waitFor();
    assert.equal(await settings.getByRole("button", { name: "新建小队" }).isDisabled(), true);
    await page.evaluate(() => window.__squads.setRemote(true));
    await settings.getByText(/当前连接不支持小队配置/).waitFor();
    assert.equal(await settings.getByRole("button", { name: "新建小队" }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, widths: [1280, 375], screenshots: shots }));
} catch (error) {
  const page = browser
    ?.contexts()
    .flatMap((context) => context.pages())
    .at(-1);
  if (page) {
    console.error(
      await page.evaluate(() => ({
        kind: document.querySelector("main")?.getAttribute("data-kind"),
        input: document.querySelector('[data-testid="main-input"]')?.textContent,
        options: [...document.querySelectorAll('[role="option"]')].map(
          (option) => option.textContent,
        ),
      })),
    );
    await page.screenshot({ path: join(shots, "failure.png"), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  await Promise.all([rm(html, { force: true }), rm(moduleFile, { force: true })]);
}
