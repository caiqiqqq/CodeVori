import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerLayout } from "../src/runtime/paths.ts";
import { createDaemonServiceDescriptor } from "../src/platform/serviceManager.ts";

test("CodeVori server layout and service identity stay separate from ZCode", () => {
  const layout = resolveServerLayout("/tmp/example/.codevori/server");
  assert.equal(layout.dataBaseDir, "/tmp/example");
  const descriptor = createDaemonServiceDescriptor({ platform: "darwin", layout });
  assert.match(descriptor.name, /^dev\.codevori\.server\./u);
  assert.doesNotMatch(descriptor.name, /zcode/u);
});
