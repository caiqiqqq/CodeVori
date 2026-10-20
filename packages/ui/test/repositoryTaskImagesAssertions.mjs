import assert from "node:assert/strict";
import { join } from "node:path";
import { selectWorkTaskExecution } from "./workTaskExecutionConfigAssertions.mjs";
import { workTaskPromptAssetsFixture } from "./workTaskPromptAssetsFixture.mjs";
import { exerciseRepositoryTaskWaiting } from "./repositoryTaskWaitingAssertions.mjs";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=";
const imageUrl =
  "https://forge.example.invalid/user-attachments/assets/12345678-1234-1234-1234-123456789abc";

export const importsFixture = `
  import {forgeTaskImageSources} from '../../../ui/src/lib/forgeTaskImages.ts';
`;

export const countRepositoryCalls = (page, ...ops) =>
  page.evaluate((ops) => window.__forge.calls.filter((call) => ops.includes(call.op)).length, ops);

export const servicesFixture = `
  state.imageUrl=${JSON.stringify(imageUrl)};
  state.imageReads=[];
  state.collectImages=(repository:any,body:string)=>forgeTaskImageSources(repository,{body,url:repository.url+'/issues/7'} as any);
  for(const host of ['A','B']) {
    const services=hosts[host], service=services.workTaskService;
    ${workTaskPromptAssetsFixture}
    const getRepository=services.gitService.getForgeRepository;
    services.gitService.getForgeRepository=async(r:any)=>{const result=await getRepository(r);if(state.imageBody&&result.repository)result.repository.url='https://forge.example.invalid/'+result.repository.name;return result};
    const getItem=services.gitService.getForgeItem;
    services.gitService.getForgeItem=async(r:any)=>{const item=await getItem(r);return state.imageBody?{...item,body:state.imageBody}:item};
    services.gitService.readForgeImage=async(r:any)=>{
      state.imageReads.push({host,...r});
      if(state.failImage){state.failImage=false;throw new Error('FORGE_FORBIDDEN')}
      if(state.delayImage){state.delayImage=false;await new Promise(resolve=>state.pending.push(resolve))}
      return {mediaType:'image/png',dataBase64:${JSON.stringify(pngBase64)},totalBytes:${Buffer.from(pngBase64, "base64").length}};
    };
  }
`;

export async function exerciseRepositoryTaskImages(page, panel, artifacts) {
  // Parser semantics: HTML/Markdown/reference sources, no code/link/network execution.
  const requests = [];
  const observeRequest = (request) => requests.push(request.url());
  page.on("request", observeRequest);
  const parsed = await page.evaluate(() => {
    const github = {
      provider: "github",
      name: "team/project",
      url: "https://github.com/team/project",
    };
    const src = "https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc";
    const body = [
      `![markdown](${src})`,
      `<img src="${src}">`,
      `![ref][shot]`,
      `[shot]: ${src.replace(/abc$/, "abd")}`,
      `[link](${src.replace(/abc$/, "abe")})`,
      "```html\n<img src='" + src.replace(/abc$/, "abf") + "'>\n```",
      "`![code](" + src.replace(/abc$/, "abf") + ")`",
      `<pre><img src="${src.replace(/abc$/, "abf")}"></pre>`,
      `<code><img src="${src.replace(/abc$/, "abf")}"></code>`,
      `<script>window.__imageScriptExecuted=true</script>`,
      "<img src='file:///tmp/secret'><img src='javascript:alert(1)'>",
      "<img src='https://other.example.invalid/shot.png'>",
    ].join("\n\n");
    const gitlab = {
      provider: "gitlab",
      name: "group/project",
      url: "https://forge.example.invalid/base/group/project",
    };
    const gitea = {
      provider: "gitea",
      name: "team/project",
      url: "https://forge.example.invalid/base/team/project",
    };
    return {
      github: window.__forge.collectImages(github, body),
      gitlab: window.__forge.collectImages(
        gitlab,
        "![shot](/uploads/" + "a".repeat(32) + "/shot.png)",
      ),
      gitea: window.__forge.collectImages(
        gitea,
        '<img src="/base/attachments/12345678-1234-1234-1234-123456789abc">',
      ),
      limit: window.__forge.collectImages(
        github,
        Array.from({ length: 10 }, (_, i) => `![shot](${src.slice(0, -1)}${i})`).join("\n"),
      ),
      executed: !!window.__imageScriptExecuted,
    };
  });
  page.off("request", observeRequest);
  assert.deepEqual(parsed.github, [
    "https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abc",
    "https://github.com/user-attachments/assets/12345678-1234-1234-1234-123456789abd",
  ]);
  assert.deepEqual(parsed.gitlab, [
    "https://forge.example.invalid/base/group/project/uploads/" + "a".repeat(32) + "/shot.png",
  ]);
  assert.deepEqual(parsed.gitea, [
    "https://forge.example.invalid/base/attachments/12345678-1234-1234-1234-123456789abc",
  ]);
  assert.equal(parsed.limit.length, 8);
  assert.equal(parsed.executed, false);
  assert.equal(
    requests.some((url) => /user-attachments|other\.example/.test(url)),
    false,
  );

  const editor = page.getByTestId("work-task-editor");
  const chips = editor.getByTestId("work-task-attachment");
  const handle = () => panel.getByTestId("repository-item-handle").first();
  const reset = async () => {
    await page.evaluate(() => {
      window.__forge.resetTasks();
      window.__forge.imageBody =
        'Screenshot evidence\n\n<img src="' +
        window.__forge.imageUrl +
        '">\n\n![duplicate](' +
        window.__forge.imageUrl +
        ")";
      window.__forge.remount();
    });
    await handle().waitFor();
  };
  const open = async () => {
    await handle().click();
    await editor.waitFor();
    await chips.first().waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-testid="work-task-attachment"] img');
      return image?.naturalWidth > 0;
    });
    assert.equal(await chips.count(), 1);
  };
  const cancel = async () => {
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await editor.waitFor({ state: "detached" });
  };
  const writes = () =>
    page.evaluate(
      () =>
        window.__forge.calls.filter((c) => /attachment-(begin|commit)|task-create/.test(c.op))
          .length,
    );
  await reset();
  await exerciseRepositoryTaskWaiting(page, panel, artifacts);
  const before = await writes();
  await open();
  const read = await page.evaluate(() => window.__forge.imageReads.at(-1));
  assert.equal(read.host, "A");
  assert.equal(read.workspacePath, "/synthetic/A");
  assert.equal(read.repositoryKey, "Aorigin");
  assert.equal(read.url, imageUrl);
  assert.equal(await writes(), before);
  await chips.first().click();
  const preview = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "issue-7-image-1.png", exact: true }) });
  await preview.waitFor();
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "detached" });
  await editor.getByTestId("work-task-attachment-remove").click();
  assert.equal(await chips.count(), 0);
  await selectWorkTaskExecution(page, editor, "acp:codex");
  assert.equal(await chips.count(), 0, "executor changes must not restore deleted images");
  await cancel();
  assert.equal(await writes(), before);

  for (const kind of ["api", "acp"]) {
    await reset();
    await open();
    await selectWorkTaskExecution(
      page,
      editor,
      kind === "api" ? "custom:synthetic:other" : "acp:codex",
    );
    if (kind === "api")
      await page.evaluate(() => {
        window.__forge.failTask = true;
      });
    await editor.getByTestId("work-task-save").click();
    if (kind === "api") {
      await editor.getByRole("alert").waitFor();
      assert.equal(await chips.count(), 1);
      const uploads = await page.evaluate(
        () => window.__forge.calls.filter((c) => c.op === "attachment-commit").length,
      );
      await editor.getByTestId("work-task-save").click();
      await editor.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(
          () => window.__forge.calls.filter((c) => c.op === "attachment-commit").length,
        ),
        uploads,
      );
    } else await editor.waitFor({ state: "detached" });
    const saved = await page.evaluate(() => {
      const task = window.__forge.tasks[0];
      return { task, bytes: [...window.__forge.assets.get(task.attachments[0].ref)] };
    });
    assert.equal(saved.task.execution.kind, kind);
    assert.equal(saved.task.attachments.length, 1);
    assert.equal(saved.task.attachments[0].mime, "image/png");
    assert.deepEqual(saved.bytes, [...Buffer.from(pngBase64, "base64")]);
    assert.equal(saved.task.status, "todo");
  }

  await reset();
  await page.evaluate(() => {
    window.__forge.failImage = true;
  });
  await handle().click();
  await panel.getByRole("alert").waitFor();
  assert.match(await panel.getByRole("alert").innerText(), /截图读取失败/);
  assert.equal(await editor.count(), 0);
  await open();
  await cancel();

  await page.evaluate(() => {
    window.__forge.delayImage = true;
  });
  await handle().click();
  await page.waitForFunction(() => window.__forge.pending.length === 1);
  await page.evaluate(() => window.__forge.switchHost("B"));
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="repository-item-row"]')
      ?.textContent?.includes("B origin"),
  );
  await page.evaluate(() => window.__forge.finish());
  assert.equal(await editor.count(), 0);
  await open();
  assert.equal(await page.evaluate(() => window.__forge.imageReads.at(-1).host), "B");
  await cancel();

  await page.evaluate(() => window.__forge.switchHost("A"));
  await page.evaluate(() => {
    window.__forge.taskRemote = true;
    window.__forge.remount();
  });
  await handle().waitFor();
  const beforeRemote = await writes();
  await open();
  const remoteRead = await page.evaluate(() => window.__forge.imageReads.at(-1));
  assert.equal(remoteRead.host, "B");
  assert.equal(remoteRead.workspaceIdentity, "synthetic-task-identity");
  await editor.getByTestId("work-task-save").click();
  await editor.getByRole("alert").waitFor();
  assert.match(await editor.getByRole("alert").innerText(), /远程项目/);
  assert.equal(
    await writes(),
    beforeRemote,
    "unsupported remote attachments never upload to local Host",
  );
  await cancel();
  await page.evaluate(() => {
    window.__forge.taskRemote = false;
  });
  await reset();
  for (const theme of ["zai-light", "zai-dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.className =
        theme === "zai-dark" ? "theme-zai-dark dark" : "theme-zai-light";
    }, theme);
    for (const width of [1120, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await open();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.mouse.move(1, 849);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({ path: join(artifacts, `issue-images-${theme}-${width}.png`) });
      await cancel();
    }
  }
  await page.evaluate(() => {
    window.__forge.imageBody = undefined;
    document.documentElement.className = "theme-zai-light";
    window.__forge.remount();
  });
  await page.setViewportSize({ width: 1120, height: 850 });
  await handle().waitFor();
}
