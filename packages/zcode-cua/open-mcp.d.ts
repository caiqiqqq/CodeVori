import type { OpenComputerUseOptions, OpenComputerUseService } from "./open-runtime.d.ts";
import type { Readable, Writable } from "node:stream";

export declare function createOpenComputerUseMcpServer(
  options?: OpenComputerUseOptions & {
    input?: Readable;
    output?: Writable;
    service?: OpenComputerUseService;
  },
): { listen(): unknown; close(): Promise<void> };
