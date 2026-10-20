#!/usr/bin/env node

import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { ComputerUseService } from "./computer-use-service.mjs";
import { HostClient } from "./host-client.mjs";
import { TOOL_BY_NAME, TOOLS } from "./tool-definitions.mjs";

export class OpenZCodeMCPServer {
  constructor({
    input = process.stdin,
    output = process.stdout,
    service = new ComputerUseService({ host: new HostClient() }),
  } = {}) {
    this.input = input;
    this.output = output;
    this.service = service;
    this.started = false;
    this.startPromise = null;
    this.lines = null;
    this.closed = false;
    this.requests = new Map();
    this.closePromise = null;
  }

  listen() {
    this.lines = readline.createInterface({ input: this.input });
    this.lines.on("line", (line) => {
      void this.receive(line);
    });
    this.lines.once("close", () => {
      void this.close();
    });
    return this;
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    for (const request of this.requests.values()) request.controller.abort();
    this.closePromise = (async () => {
      await this.startPromise?.catch(() => {});
      await Promise.allSettled([...this.requests.values()].map((request) => request.operation));
      this.started = false;
      await this.service.close().catch((error) => {
        process.stderr.write(`open-zcode-computer-use cleanup failed: ${error.message}\n`);
      });
    })();
    this.lines?.close();
    return this.closePromise;
  }

  async ensureStarted() {
    if (this.started) return;
    if (!this.startPromise) {
      this.startPromise = this.service.start()
        .then(() => {
          this.started = true;
        })
        .catch(async (error) => {
          await this.service.close().catch(() => {});
          throw error;
        })
        .finally(() => {
          this.startPromise = null;
        });
    }
    await this.startPromise;
  }

  async receive(line) {
    if (this.closed) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.sendError(null, -32700, "Parse error");
      return;
    }
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      if (message?.id !== undefined) this.sendError(message.id, -32600, "Invalid Request");
      return;
    }
    if (message.id === undefined) {
      if (message.method === "notifications/cancelled") {
        this.requests.get(message.params?.requestId)?.controller.abort();
      }
      return;
    }

    try {
      switch (message.method) {
      case "initialize":
        this.sendResult(message.id, {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: "open-zcode-computer-use",
            version: "0.1.0",
          },
          instructions:
            "Observe once, act once, then verify. Prefer element targets from get_app_state; use coordinates only from the latest returned image.",
        });
        return;
      case "ping":
        this.sendResult(message.id, {});
        return;
      case "tools/list":
        this.sendResult(message.id, { tools: TOOLS });
        return;
      case "tools/call":
        if (this.requests.has(message.id)) {
          this.sendError(message.id, -32600, "Duplicate request id");
          return;
        }
        {
          const controller = new AbortController();
          const operation = this.handleToolCall(message, controller.signal);
          this.requests.set(message.id, { controller, operation });
          try { await operation; } finally { this.requests.delete(message.id); }
        }
        return;
      default:
        this.sendError(message.id, -32601, "Method not found");
      }
    } catch (error) {
      this.sendError(message.id, -32603, error instanceof Error ? error.message : String(error));
    }
  }

  async handleToolCall(message, signal) {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (!TOOL_BY_NAME.has(name)) {
      this.sendError(message.id, -32602, `Unknown tool: ${String(name)}`);
      return;
    }
    const runtimeScope =
      message.params?._meta?.["com.zcode/request-context"]?.runtime_scope
      ?? message.params?._meta?.["com.zcode/request-context.runtime_scope"];
    if (runtimeScope === "subagent") {
      this.sendResult(message.id, {
        isError: true,
        content: [{
          type: "text",
          text: "SUBAGENT_COMPUTER_USE_UNAVAILABLE: desktop control is restricted to the main agent",
        }],
      });
      return;
    }
    const validationErrors = validateSchema(TOOL_BY_NAME.get(name).inputSchema, args);
    if (validationErrors.length > 0) {
      this.sendError(message.id, -32602, `Invalid arguments: ${validationErrors.join("; ")}`);
      return;
    }
    await this.ensureStarted();
    if (this.closed || signal?.aborted) return;
    this.sendResult(message.id, await this.service.callTool(name, args, { signal, runtimeScope }));
  }

  sendResult(id, result) {
    if (this.closed) return;
    this.output.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  sendError(id, code, message) {
    if (this.closed) return;
    this.output.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message },
    })}\n`);
  }
}

export function validateSchema(schema, value, location = "$") {
  if (schema.anyOf) {
    return schema.anyOf.some((candidate) => validateSchema(candidate, value, location).length === 0)
      ? []
      : [`${location} does not match any allowed shape`];
  }
  if (schema.const !== undefined && value !== schema.const) {
    return [`${location} must equal ${JSON.stringify(schema.const)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return [`${location} must be one of ${schema.enum.join(", ")}`];
  }

  const typeMatches =
    schema.type === undefined ||
    (schema.type === "null" && value === null) ||
    (schema.type === "array" && Array.isArray(value)) ||
    (schema.type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) ||
    (schema.type === "integer" && Number.isSafeInteger(value)) ||
    (schema.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (schema.type === "string" && typeof value === "string") ||
    (schema.type === "boolean" && typeof value === "boolean");
  if (!typeMatches) return [`${location} must be ${schema.type}`];

  const errors = [];
  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) errors.push(`${location}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) errors.push(`${location}.${key} is not allowed`);
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) {
        errors.push(...validateSchema(propertySchema, value[key], `${location}.${key}`));
      }
    }
  }
  if (schema.type === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location} requires at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${location} allows at most ${schema.maxItems} items`);
    }
    value.forEach((item, index) => {
      errors.push(...validateSchema(schema.items ?? {}, item, `${location}[${index}]`));
    });
  }
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${location} is shorter than ${schema.minLength}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${location} must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${location} must be at most ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${location} must be greater than ${schema.exclusiveMinimum}`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = new OpenZCodeMCPServer().listen();
  const shutdown = async () => {
    await server.close();
    process.exit();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
