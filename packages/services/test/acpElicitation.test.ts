import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseAcpElicitationForm, validateAcpElicitationContent } from "@zcode/shared";
import { createAcpService, type AcpConnectionFactory } from "../src/acp/acpServiceImpl.js";

const workspace = { workspacePath: "/synthetic/input", workspaceIdentity: "remote:input" };
const form = () => ({
  requestId: "input-1",
  message: "Allow archive?",
  fields: parseAcpElicitationForm({
    type: "object",
    required: ["choice"],
    properties: {
      choice: {
        type: "string",
        oneOf: [
          { const: "yes", title: "同意" },
          { const: "no", title: "不同意" },
        ],
      },
      note: { type: "string", _meta: { codex: { isSecret: true } } },
    },
  }),
});

test("ACP form projection and typed answer validation preserve schema keys and constraints", () => {
  const fields = parseAcpElicitationForm({
    properties: {
      choice: { type: "string", enum: ["yes", "no"] },
      count: { type: "integer", minimum: 1, maximum: 3 },
      flag: { type: "boolean" },
      tags: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: { anyOf: [{ const: "a", title: "A" }] },
      },
      note: { type: "string", minLength: 2, maxLength: 8, pattern: "^ok" },
    },
    required: ["flag"],
  });
  assert.equal(validateAcpElicitationContent(fields, { flag: false }), true);
  assert.equal(
    validateAcpElicitationContent(fields, { flag: true, count: 2, tags: ["a"], note: "okay" }),
    true,
  );
  for (const content of [
    {},
    { flag: "false" },
    { flag: true, count: 1.5 },
    { flag: true, count: 4 },
    { flag: true, tags: ["a", "a"] },
    { flag: true, tags: ["b"] },
    { flag: true, note: "no" },
    { flag: true, extra: "x" },
  ]) {
    assert.equal(validateAcpElicitationContent(fields, content), false);
  }
  assert.throws(() => parseAcpElicitationForm({ properties: { nested: { type: "object" } } }));
  assert.throws(() => parseAcpElicitationForm({ required: ["missing"] }));
  assert.equal(form().fields[1].sensitive, true);
});

test("Host serializes permission/forms, validates target, rejects duplicate and late answers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-input-"));
  let callbacks!: Parameters<AcpConnectionFactory>[0];
  let release!: () => void;
  const connect: AcpConnectionFactory = async (input) => {
    callbacks = input;
    return {
      sessionId: "native",
      configOptions: [],
      modeState: null,
      async setConfigOption() {
        return [];
      },
      async setMode() {},
      async prompt() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      async cancel() {
        release();
      },
      close() {},
    };
  };
  let service = createAcpService({ directory, connect });
  const waitFor = async (
    predicate: (session: Awaited<ReturnType<typeof service.read>>) => boolean,
  ) => {
    for (let i = 0; i < 100; i++) {
      const snapshot = await service.read({ ...workspace, id: session.id });
      if (predicate(snapshot)) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("Host request was not projected");
  };
  const session = await service.create({ ...workspace, agent: "codex" });
  try {
    await service.submitPrompt({
      ...workspace,
      id: session.id,
      commandId: "turn-1",
      text: "fixture",
    });
    await waitFor(() => Boolean(release));
    const permission = callbacks.onPermission({
      requestId: "permission",
      title: "Tool",
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    const answer = callbacks.onElicitation!(form());
    const first = await waitFor((s) => Boolean(s.pendingPermission));
    assert.equal(first.pendingElicitation, null);
    await service.decide({
      ...workspace,
      id: session.id,
      requestId: "permission",
      optionId: "allow",
    });
    assert.equal(await permission, "allow");
    await waitFor((s) => Boolean(s.pendingElicitation));
    const input = {
      ...workspace,
      id: session.id,
      requestId: "input-1",
      action: "accept" as const,
      content: { choice: "yes", note: "synthetic-secret" },
    };
    await assert.rejects(service.respondElicitation({ ...input, workspaceIdentity: "wrong" }));
    await assert.rejects(service.respondElicitation({ ...input, content: { choice: "invented" } }));
    const submissions = await Promise.allSettled([
      service.respondElicitation(input),
      service.respondElicitation(input),
    ]);
    assert.equal(submissions.filter((result) => result.status === "fulfilled").length, 1);
    assert.deepEqual(await answer, { action: "accept", content: input.content });
    await assert.rejects(service.respondElicitation(input), /expired/);
    assert.equal((await service.read({ ...workspace, id: session.id })).pendingElicitation, null);
    assert.doesNotMatch(
      await readFile(join(directory, `${session.id}.json`), "utf8"),
      /synthetic-secret/,
    );
    assert.doesNotMatch(
      JSON.stringify(await service.getExecutionTrace({ ...workspace, id: session.id })),
      /synthetic-secret/,
    );

    const queuedController = new AbortController();
    const blocking = callbacks.onPermission({
      requestId: "blocking",
      title: "Tool",
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    const queued = callbacks.onElicitation!(
      { ...form(), requestId: "queued" },
      queuedController.signal,
    );
    await waitFor((s) => s.pendingPermission?.requestId === "blocking");
    queuedController.abort();
    assert.deepEqual(await queued, { action: "cancel" });
    assert.equal(
      (await service.read({ ...workspace, id: session.id })).pendingPermission?.requestId,
      "blocking",
    );
    await service.decide({
      ...workspace,
      id: session.id,
      requestId: "blocking",
      optionId: "allow",
    });
    assert.equal(await blocking, "allow");

    const controller = new AbortController();
    const cancelled = callbacks.onElicitation!(
      { ...form(), requestId: "aborted" },
      controller.signal,
    );
    await waitFor((s) => s.pendingElicitation?.requestId === "aborted");
    controller.abort();
    assert.deepEqual(await cancelled, { action: "cancel" });
    await waitFor((s) => !s.pendingElicitation);

    const stopped = callbacks.onElicitation!(form());
    await waitFor((s) => Boolean(s.pendingElicitation));
    await service.stop({ ...workspace, id: session.id });
    assert.deepEqual(await stopped, { action: "cancel" });
    await assert.rejects(service.respondElicitation(input), /expired/);

    await service.submitPrompt({
      ...workspace,
      id: session.id,
      commandId: "turn-2",
      text: "fixture",
    });
    const exited = callbacks.onElicitation!(form());
    await waitFor((s) => Boolean(s.pendingElicitation));
    const oldCallbacks = callbacks;
    callbacks.onExit("fixture process lost");
    assert.deepEqual(await exited, { action: "cancel" });
    await waitFor((s) => s.status === "interrupted" && !s.pendingElicitation);
    await assert.rejects(service.respondElicitation(input), /expired/);

    await service.submitPrompt({
      ...workspace,
      id: session.id,
      commandId: "turn-3",
      text: "fixture",
    });
    assert.deepEqual(await oldCallbacks.onElicitation!(form()), { action: "cancel" });
    const restarted = callbacks.onElicitation!(form());
    await waitFor((s) => Boolean(s.pendingElicitation));
    service.disposeAll();
    assert.deepEqual(await restarted, { action: "cancel" });
    service = createAcpService({ directory, connect });
    assert.equal((await service.read({ ...workspace, id: session.id })).pendingElicitation, null);
    assert.equal((await service.read({ ...workspace, id: session.id })).status, "interrupted");
  } finally {
    service.disposeAll();
    await rm(directory, { recursive: true, force: true });
  }
});
