import assert from "node:assert/strict";
import test from "node:test";
import { installScriptSource } from "./installer.mjs";

test("standalone installer uses the CodeVori archive and command names", () => {
  const script = installScriptSource("https://example.test/codevori/");
  assert.match(script, /mv "\$TARGET\.new\/codevori" "\$TARGET"/);
  assert.match(script, /cat > "\$BIN_DIR\/codevori"/);
  assert.match(script, /current\/bin\/codevori\.mjs/);
  assert.doesNotMatch(script, /\$BIN_DIR\/zcode|\.new\/zcode/);
});
