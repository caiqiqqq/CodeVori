import assert from "node:assert/strict";
import test from "node:test";
import { deviceNodeBuildPlan, validateBuildServiceUrl } from "./package-device-node.mjs";

test("client and service distributions use disjoint roots and platform matrices", () => {
  const plan = deviceNodeBuildPlan("0.0.5", "/artifacts");
  assert.equal(plan.clients, "/artifacts/clients/0.0.5");
  assert.equal(plan.services, "/artifacts/service/0.0.5");
  assert.equal(plan.clientTargets.length, 6);
  assert.equal(plan.serviceTargets.length, 2);
});

test("local builds require explicit loopback selection; release builds require HTTPS", () => {
  assert.equal(validateBuildServiceUrl("http://127.0.0.1:18081", true), "http://127.0.0.1:18081");
  assert.equal(
    validateBuildServiceUrl("https://example.test/nodes/"),
    "https://example.test/nodes",
  );
  for (const url of [
    "http://127.0.0.1:18081",
    "http://192.168.1.2:18081",
    "https://a:b@example.test",
    "https://example.test/?token=x",
  ]) {
    assert.throws(() => validateBuildServiceUrl(url));
  }
  for (const url of [
    "http://192.168.1.2:18081",
    "https://example.test",
    "http://127.0.0.1:18081/?x=y",
  ]) {
    assert.throws(() => validateBuildServiceUrl(url, true));
  }
});
