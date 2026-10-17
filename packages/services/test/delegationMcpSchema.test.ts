import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workTaskAttachmentSchema } from "@zcode/shared";
import { AgentDelegationService } from "../src/delegation/agentDelegationService.js";
import { createDelegationMcp } from "../src/delegation/delegationMcp.js";

for (const kind of ["api", "acp"] as const) {
  test(`${kind} delegation MCP publishes portable attachment filename patterns`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "zcode-delegation-schema-"));
    const service = new AgentDelegationService({
      path: join(directory, "tasks.sqlite"),
      targets: async () => [],
      execute: async () => {
        throw new Error("schema listing must not execute a task");
      },
      deliver: async () => false,
    });
    const bridge = createDelegationMcp(directory, service);
    try {
      const registration = (await bridge.register({
        workspacePath: directory,
        kind,
        sessionId: "schema-parent",
      }))!;
      const env = registration.record.config.env!;
      const response = await fetch(env.ZCODE_WORKFLOW_URL!, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.ZCODE_WORKFLOW_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(response.status, 200);
      const { result } = (await response.json()) as {
        result: {
          tools: Array<{
            name: string;
            inputSchema: {
              additionalProperties: boolean;
              properties: {
                attachments: {
                  items: {
                    properties: {
                      fileName: { pattern: string; minLength: number; maxLength: number };
                    };
                  };
                };
              };
            };
          }>;
        };
      };
      for (const name of ["DelegateTask", "FollowUpDelegation"]) {
        const tool = result.tools.find((tool) => tool.name === name)!;
        assert.ok(tool, name);
        assert.equal(tool.inputSchema.additionalProperties, false);
        const fileName = tool.inputSchema.properties.attachments.items.properties.fileName;
        // #188：JS 接受的空字符转义 \0 会被外部模型的正则校验器拒绝。
        assert.doesNotMatch(fileName.pattern, /\\0/, `${name} must not publish a null escape`);
        assert.equal(fileName.minLength, 1);
        assert.equal(fileName.maxLength, 255);
        const pattern = new RegExp(fileName.pattern, "u");
        for (const value of ["image.png", "证据 01.txt", "0.txt", "emoji-😀.txt"]) {
          assert.equal(pattern.test(value), true, name);
          assert.equal(workTaskAttachmentSchema.shape.fileName.safeParse(value).success, true);
        }
        for (const value of ["bad\0name.txt", "bad\rname.txt", "bad\nname.txt"]) {
          assert.equal(pattern.test(value), false, name);
          assert.equal(workTaskAttachmentSchema.shape.fileName.safeParse(value).success, false);
        }
      }
      for (const value of ["", "x".repeat(256)]) {
        assert.equal(workTaskAttachmentSchema.shape.fileName.safeParse(value).success, false);
      }
    } finally {
      bridge.dispose();
      await service.disposeAllAndWait();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
