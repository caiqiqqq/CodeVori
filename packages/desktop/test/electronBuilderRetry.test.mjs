import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryElectronBuilderFailure } from "../scripts/electron-builder-retry.mjs";

test("DMG detach resource-busy failures enter the bounded packaging retry", () => {
  assert.equal(
    shouldRetryElectronBuilderFailure(
      'dmgbuild.core.DMGError: Unable to detach device cleanly: hdiutil: couldn\'t eject "disk2" - Resource busy',
    ),
    true,
  );
  assert.equal(shouldRetryElectronBuilderFailure("download: connection reset by peer"), true);
});

test("packaging retries do not hide signing, source or missing-resource failures", () => {
  for (const output of [
    "codesign: errSecInternalComponent",
    "TypeScript compilation failed",
    "ditto: Cannot get the real path for source '.background.tiff'",
    "hdiutil: permission denied",
    "resource busy: unrelated lock",
  ])
    assert.equal(shouldRetryElectronBuilderFailure(output), false, output);
});
