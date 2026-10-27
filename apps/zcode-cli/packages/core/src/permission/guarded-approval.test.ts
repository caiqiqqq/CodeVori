import assert from "node:assert/strict";
import test from "node:test";
import { PermissionService } from "./service.js";
import { matchDangerousCommand } from "../tool/handlers/guarded/command.js";
import { applyPreToolPermissionDecision } from "../tool/executor/hook-flow.js";

test("guarded asks once for dangerous commands, ignores allow rules and preserves Plan", () => {
  const service = new PermissionService();
  for (const command of [
    "rm -rf build",
    "sudo rm -r build",
    "git reset --hard HEAD",
    "find . -delete",
    "rsync --delete a b",
    "echo ok && rm -rf build",
  ]) {
    const match = matchDangerousCommand(command, "posix");
    assert.equal(match.status, "matched", command);
    if (match.status !== "matched") continue;
    const context = {
      toolName: "Bash",
      input: { command },
      mode: "guarded" as const,
      riskLevel: "medium" as const,
    };
    const capability = { userApprovalRule: match.ruleId, destructive: false };
    const decision = service.checkPermission(context, capability, {
      allow: [{ toolName: "Bash" }],
    });
    assert.equal(decision.decision, "ask");
    assert.equal(decision.approvalMode, "user-once");
    assert.equal(
      applyPreToolPermissionDecision(decision, { permissionBehavior: "allow" } as never, "guarded")
        .decision,
      "ask",
    );
    assert.equal(
      service.checkPermission({ ...context, planEnabled: true }, capability).decision,
      "deny",
    );
    assert.equal(
      service.checkPermission({ ...context, mode: "yolo" }, capability).decision,
      "allow",
    );
  }
  assert.notEqual(matchDangerousCommand("git status && ls -la", "posix").status, "matched");
  assert.equal(matchDangerousCommand("rd /s /q build", "cmd").status, "matched");
  assert.equal(
    service.checkPermission({
      toolName: "Bash",
      input: { command: "git status" },
      mode: "guarded",
      riskLevel: "low",
    }).decision,
    "allow",
  );
});

test("guarded runtime always asks the user, strips grants and stops on denial or cancellation", async () => {
  const { resolveToolPermission } = await import("../tool/executor/permission-flow.js");
  const { bashToolEntry } = await import("../tool/handlers/bash.js");
  const { createRootTraceContext } = await import("@zcode/contracts");
  let asks = 0;
  let hooks = 0;
  let grantWrites = 0;
  let decision = "allow";
  const permissionService = new PermissionService();
  permissionService.grantSessionPermission = () => {
    grantWrites++;
  };
  const deps = {
    sessionId: "guarded-test",
    permissionService,
    getMode: () => "guarded",
    getWorkingDirectory: () => "/fixture",
    getWorkspaceRoot: () => "/fixture",
    emitEvent: async () => {},
    hookRunner: {
      run: async () => {
        hooks++;
        throw Error("must not call PermissionRequest hooks");
      },
    },
    permissionBroker: {
      requestPermission: async (request: any, { signal }: any) => {
        asks++;
        assert.equal(request.optionsPolicy, "no-always-allow");
        if (signal.aborted) throw signal.reason;
        return {
          decision,
          permissionUpdates: [{ toolName: "Bash" }],
          sessionPermissionUpdates: [{ toolName: "Bash" }],
        };
      },
    },
  } as any;
  const entry = { ...bashToolEntry, prepareApproval: () => ({ gate: "proceed" as const }) };
  const command = { command: "rm -rf fixture" };
  const run = (signal?: AbortSignal) =>
    resolveToolPermission(
      deps,
      { id: "tool-1", name: "Bash", input: command } as any,
      entry,
      command,
      { additionalContexts: [], permissionBehavior: "allow" },
      "guarded",
      createRootTraceContext(),
      signal,
    );
  assert.equal((await run()).allowed, true);
  assert.equal((await run()).allowed, true);
  assert.equal(asks, 2);
  assert.equal(hooks, 0);
  assert.equal(grantWrites, 0);
  decision = "deny";
  assert.equal((await run()).allowed, false);
  const controller = new AbortController();
  controller.abort(Error("cancelled"));
  assert.equal((await run(controller.signal)).allowed, false);
});
