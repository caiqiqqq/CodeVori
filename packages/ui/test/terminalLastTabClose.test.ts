import assert from "node:assert/strict";
import test from "node:test";
import {
  closeTerminalSession,
  ensureWorkspaceTerminalState,
  getTerminalSessionCloseAction,
} from "../src/terminal/terminalPanelState.ts";
import type { IServiceAccessor } from "@zcode/services";
test("closing the final tab removes its session while retaining other workspace terminals", () => {
  const services = {} as IServiceAccessor;
  let state = ensureWorkspaceTerminalState(
    { sessions: {}, workspaces: {} },
    { workspaceKey: "local", services },
  );
  state = ensureWorkspaceTerminalState(state, { workspaceKey: "remote", services });
  const oldId = state.workspaces.local.activeSessionId;
  assert.equal(getTerminalSessionCloseAction(state, oldId), "close-panel");
  const closed = closeTerminalSession(state, oldId);
  assert.equal(closed.sessions[oldId], undefined);
  assert.equal(closed.workspaces.local, undefined);
  assert.equal(closed.workspaces.remote, state.workspaces.remote);
  assert.equal(closeTerminalSession(closed, oldId), closed);
  const reopened = ensureWorkspaceTerminalState(closed, { workspaceKey: "local", services });
  assert.notEqual(reopened.workspaces.local.activeSessionId, oldId);
});
