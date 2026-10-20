import assert from "node:assert/strict";
import test from "node:test";
import {
  projectAcpSessionFailure,
  failureFromAcpError,
  recordAcpSessionFailure,
} from "../src/acp/acpSessionFailures.js";
import type { AcpSession } from "@zcode/shared";

const failure = {
  id: "incident",
  revision: 1,
  severity: "error",
  category: "connection",
  title: "SSE timeout",
  actions: ["retry"],
} as const;
const meta = (value: unknown, version: unknown = 1) => ({
  jetbrains: { air: { version, sessionFailure: value } },
});

test("versioned failure metadata validates structure and bounds payloads", () => {
  assert.deepEqual(projectAcpSessionFailure(meta(failure)), failure);
  for (const value of [
    null,
    {},
    { ...failure, revision: -1 },
    { ...failure, severity: "fatal" },
    { ...failure, title: "" },
  ])
    assert.equal(projectAcpSessionFailure(meta(value)), undefined);
  assert.equal(
    projectAcpSessionFailure({ jetbrains: { air: { sessionFailure: failure } } }),
    undefined,
  );
  for (const version of [0, 1.5, "1"])
    assert.equal(projectAcpSessionFailure(meta(failure, version)), undefined);
  assert.equal(projectAcpSessionFailure({ sessionFailure: failure }), undefined);
  const bounded = projectAcpSessionFailure(
    meta({ ...failure, title: "x".repeat(40_000), details: "y".repeat(40_000) }),
  )!;
  assert.equal(bounded.title.length, 32_000);
  assert.equal(bounded.details?.length, 32_000);
});

test("Host deduplicates incident revisions, keeps errors terminal, and preserves prior turns", () => {
  const session = {
    entries: [{ id: "user:cmd", kind: "user", text: "question" }],
    error: null,
  } as AcpSession;
  assert.equal(
    recordAcpSessionFailure(session, "cmd", { ...failure, severity: "warning", actions: [] }),
    true,
  );
  assert.equal(session.error, null);
  assert.equal(recordAcpSessionFailure(session, "cmd", { ...failure, revision: 2 }), true);
  assert.equal(recordAcpSessionFailure(session, "cmd", { ...failure, revision: 2 }), false);
  assert.equal(
    recordAcpSessionFailure(session, "cmd", { ...failure, revision: 3, severity: "warning" }),
    false,
  );
  assert.equal(session.entries[0]?.kind === "user" && session.entries[0].traceError, failure.title);
  session.entries.push({ id: "user:next", kind: "user", text: "next" });
  assert.equal(recordAcpSessionFailure(session, "missing", { ...failure }), false);
  assert.equal(session.entries[0]?.kind === "user" && session.entries[0].failures?.length, 1);
});

test("RPC error details remain readable and use the same failure shape", () => {
  assert.equal(failureFromAcpError(new Error("failure"), "x".repeat(2000)).id.length, 512);
  const error = Object.assign(new Error("Internal error"), {
    data: { details: "SSE disconnected" },
  });
  assert.equal(failureFromAcpError(error, "cmd").title, "SSE disconnected");
  assert.equal(
    failureFromAcpError(Object.assign(error, { data: { _meta: meta(failure) } }), "cmd").id,
    "incident",
  );
});

test("bounded notice storage evicts warnings before confirmed failures", () => {
  const session = {
    entries: [{ id: "user:cmd", kind: "user", text: "question" }],
    error: null,
  } as AcpSession;
  for (let n = 0; n < 64; n++)
    recordAcpSessionFailure(session, "cmd", {
      ...failure,
      id: String(n),
      severity: "warning",
      actions: [],
    });
  recordAcpSessionFailure(session, "cmd", { ...failure, id: "terminal" });
  const user = session.entries[0]!;
  if (user.kind !== "user") throw new Error("missing user");
  assert.equal(user.failures?.length, 64);
  assert.equal(user.failures?.filter((item) => item.severity === "error").length, 1);
  assert.equal(session.errorCommandId, "cmd");
});
