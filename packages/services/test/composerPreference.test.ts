import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProxyChannel } from "@zcode/rpc";
import type { IComposerPreferenceService } from "../src/composer-preference/contract.js";
import { createComposerPreferenceService } from "../src/composer-preference/composerPreferenceService.js";

test("Host serializes scoped preferences, broadcasts committed revisions and restores after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-composer-preference-"));
  try {
    const owner = createComposerPreferenceService(directory);
    const serverChannel = ProxyChannel.fromService(owner);
    const channel = {
      call: <T>(command: string, arg?: unknown[]) => serverChannel.call<T>(undefined, command, arg),
      listen: <T>(event: string, arg?: unknown) => serverChannel.listen<T>(undefined, event, arg),
    };
    const service = ProxyChannel.toService<IComposerPreferenceService>(channel);
    const mobile = ProxyChannel.toService<IComposerPreferenceService>(channel);
    const scope = { workspacePath: "/repo", workspaceIdentity: "remote:one" };
    const revisions: number[] = [];
    const subscription = mobile.onDynamicChanged(scope)((value) => revisions.push(value.revision));
    const first = {
      ...scope,
      commandId: randomUUID(),
      target: { kind: "api" as const, selection: { providerId: "provider", modelId: "model" } },
    };
    await Promise.all([
      service.update(first),
      service.update({
        ...scope,
        commandId: randomUUID(),
        acpModel: { agent: "codex", configId: "model", value: "chosen" },
      }),
      service.update({
        ...scope,
        commandId: randomUUID(),
        acpModel: { agent: "claude", configId: "model", value: "other" },
      }),
      service.update({
        workspacePath: "/repo",
        workspaceIdentity: "remote:two",
        commandId: randomUUID(),
        target: { kind: "acp", agent: "claude" },
      }),
    ]);
    assert.deepEqual(revisions, [1, 2, 3]);
    const saved = await service.get(scope);
    assert.equal(saved.acpModels.codex?.value, "chosen");
    assert.equal(saved.acpModels.claude?.value, "other");
    assert.deepEqual(saved.target, first.target);
    assert.deepEqual(await createComposerPreferenceService(directory).get(scope), saved);
    assert.deepEqual(
      await service.update(first),
      saved,
      "an older command retry must not overwrite newer preferences",
    );
    assert.deepEqual(revisions, [1, 2, 3]);
    assert.deepEqual(
      (await service.get({ ...scope, remoteSessionId: "new-attachment" })).target,
      first.target,
    );
    assert.equal((await service.get({ workspacePath: "/repo" })).revision, 0);
    subscription.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preference writes reject invalid input and do not emit success on IO failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-composer-preference-failure-"));
  try {
    const blocker = join(directory, "file");
    await writeFile(blocker, "block directory");
    const service = createComposerPreferenceService(join(blocker, "preferences"));
    let emitted = false;
    const scope = { workspacePath: "/repo" };
    const subscription = service.onDynamicChanged(scope)(() => {
      emitted = true;
    });
    await assert.rejects(service.update({ ...scope, commandId: randomUUID() }));
    await assert.rejects(
      service.update({
        ...scope,
        commandId: randomUUID(),
        target: { kind: "acp", agent: "codex" },
      }),
    );
    assert.equal(emitted, false);
    subscription.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
