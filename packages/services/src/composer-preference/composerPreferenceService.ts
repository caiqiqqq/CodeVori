import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Emitter, Event } from "@zcode/rpc";
import {
  composerPreferenceSchema,
  composerPreferenceScopeSchema,
  composerPreferenceUpdateSchema,
  type ComposerPreference,
  type ComposerPreferenceScope,
} from "@zcode/shared";
import { getZCodeDataRootDir } from "../paths.js";
import { atomicWriteText } from "../fs/atomicFileUtils.js";
import type { IComposerPreferenceService } from "./contract.js";

const fileSchema = z.object({
  version: z.literal(1),
  preference: composerPreferenceSchema,
  commands: z.array(z.string().uuid()).max(64),
});
const keyOf = (scope: ComposerPreferenceScope) =>
  scope.workspaceIdentity?.trim() || scope.workspacePath;

export function createComposerPreferenceService(
  directory = join(getZCodeDataRootDir(), "composer-preferences"),
): IComposerPreferenceService {
  const writes = new Map<string, Promise<unknown>>();
  const changed = new Emitter<{ key: string; preference: ComposerPreference }>();
  const pathOf = (key: string) =>
    join(directory, `${createHash("sha256").update(key).digest("hex")}.json`);
  const read = async (key: string): Promise<z.infer<typeof fileSchema>> => {
    try {
      return fileSchema.parse(JSON.parse(await readFile(pathOf(key), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, preference: { revision: 0, acpModels: {} }, commands: [] };
      throw new Error("Model preference could not be read", { cause: error });
    }
  };
  return {
    async get(input) {
      const key = keyOf(composerPreferenceScopeSchema.parse(input));
      await writes.get(key);
      return (await read(key)).preference;
    },
    async update(input) {
      const parsed = composerPreferenceUpdateSchema.parse(input);
      const key = keyOf(parsed);
      // 修复原因：各端 localStorage 互不相通；偏好统一在目标 Host 排队合并，落盘后才广播。
      const next = (writes.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          const file = await read(key);
          if (file.commands.includes(parsed.commandId)) return file.preference;
          const preference: ComposerPreference = {
            ...file.preference,
            revision: file.preference.revision + 1,
            ...(parsed.target ? { target: parsed.target } : {}),
            acpModels: {
              ...file.preference.acpModels,
              ...(parsed.acpModel
                ? {
                    [parsed.acpModel.agent]: {
                      configId: parsed.acpModel.configId,
                      value: parsed.acpModel.value,
                    },
                  }
                : {}),
            },
          };
          await atomicWriteText(
            pathOf(key),
            JSON.stringify({
              version: 1,
              preference,
              commands: [...file.commands, parsed.commandId].slice(-64),
            }),
          );
          changed.fire({ key, preference: structuredClone(preference) });
          return preference;
        });
      writes.set(key, next);
      try {
        return structuredClone(await next);
      } finally {
        if (writes.get(key) === next) writes.delete(key);
      }
    },
    onDynamicChanged(input) {
      const key = keyOf(composerPreferenceScopeSchema.parse(input));
      return Event.map(
        Event.filter(changed.event, (event) => event.key === key),
        (event) => event.preference,
      );
    },
  };
}
