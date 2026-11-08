import assert from "node:assert/strict";
import test from "node:test";
import { getCheckpointRefName } from "../src/git/repo/gitCheckpointHelpers.ts";

test("new checkpoints use the CodeVori Git ref namespace", () => {
  assert.match(
    getCheckpointRefName("/workspace", "checkpoint-1"),
    /^refs\/codevori\/checkpoints\/[^/]+\/checkpoint-1$/,
  );
});
