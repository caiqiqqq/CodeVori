import assert from "node:assert/strict";
import test from "node:test";
import { getDeviceBridgeErrorCode } from "@zcode/shared";

test("only safe bridge error codes survive the Electron IPC boundary", () => {
  for (const code of [
    "device_bridge_component_missing",
    "device_bridge_component_not_executable",
    "device_bridge_start_failed",
    "device_bridge_process_closed",
  ]) {
    assert.equal(getDeviceBridgeErrorCode(code), code);
    assert.equal(
      getDeviceBridgeErrorCode(new Error(`Error invoking remote method 'bridge': Error: ${code}`)),
      code,
    );
  }
  for (const unsafe of [
    undefined,
    {},
    "private-auth-url",
    new Error("private token: device_bridge_component_missing extra"),
  ]) {
    assert.equal(getDeviceBridgeErrorCode(unsafe), "device_bridge_operation_failed");
  }
});
