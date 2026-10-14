import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import config from "../electron-builder.config.js";

const require = createRequire(import.meta.url);

test("production packaging uses the installed, exactly pinned Electron runtime", () => {
  const pin = require("../package.json").devDependencies.electron;
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(require("electron/package.json").version, pin);
  assert.equal(config.electronVersion, pin);
});
