import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readZCodeDataSizeTelemetryState } from "../src/main/zcodeDataSizeTelemetryState.js";

test("telemetry state ignores the old file when current state is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codevori-telemetry-state-"));
  const current = join(directory, "codevori-data-size-telemetry.json");
  const legacy = join(directory, "zcode-data-size-telemetry.json");
  try {
    await writeFile(legacy, JSON.stringify({ lastReportedAt: 100 }));
    assert.equal(await readZCodeDataSizeTelemetryState(current), null);
    await writeFile(current, JSON.stringify({ lastReportedAt: 200 }));
    assert.deepEqual(await readZCodeDataSizeTelemetryState(current), {
      lastReportedAt: 200,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
