import assert from "node:assert/strict";
import test from "node:test";
import { matchesTaskListMembershipKind } from "../../shared/src/zcode-protocol-v4/controller.ts";

test("unread membership includes pinned unread tasks and excludes read or archived tasks", () => {
  assert.equal(
    matchesTaskListMembershipKind({ pinned: false, archived: false }, "unread", 123),
    true,
  );
  assert.equal(
    matchesTaskListMembershipKind({ pinned: true, archived: false }, "unread", 123),
    true,
  );
  assert.equal(matchesTaskListMembershipKind({ pinned: false, archived: false }, "unread"), false);
  assert.equal(
    matchesTaskListMembershipKind({ pinned: true, archived: true }, "unread", 123),
    false,
  );
});
