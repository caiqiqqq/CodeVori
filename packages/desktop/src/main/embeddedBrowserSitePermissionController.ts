import { randomUUID } from "node:crypto";
import type { EmbeddedBrowserSitePermissionPrompt } from "@zcode/shared";

export type SitePermissionState = "allow" | "deny";
export type SitePermissionRecord = Record<string, Record<string, SitePermissionState>>;
export type SitePermissionAction = "allow-always" | "allow-session" | "dismiss";

const SILENT_ALLOW = new Set([
  "clipboard-sanitized-write",
  "fullscreen",
  "pointerLock",
  "mediaKeySystem",
]);
const PROMPTABLE = new Set([
  "media",
  "clipboard-read",
  "geolocation",
  "notifications",
  "midi",
  "midiSysex",
  "idle-detection",
  "speaker-selection",
  "window-management",
  "storage-access",
  "top-level-storage-access",
  "keyboardLock",
  "fileSystem",
]);
const STORED_PERMISSIONS = new Set([...PROMPTABLE].filter((permission) => permission !== "media"));
STORED_PERMISSIONS.add("media:audio");
STORED_PERMISSIONS.add("media:video");

export function normalizeSitePermissionOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin !== "null"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function isSilentSitePermission(permission: string): boolean {
  return SILENT_ALLOW.has(permission);
}

function cleanRecord(value: unknown): SitePermissionRecord {
  const record: SitePermissionRecord = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return record;
  for (const [origin, permissions] of Object.entries(value)) {
    if (
      normalizeSitePermissionOrigin(origin) !== origin ||
      !permissions ||
      typeof permissions !== "object" ||
      Array.isArray(permissions)
    )
      continue;
    const next: Record<string, SitePermissionState> = Object.create(null);
    for (const [permission, state] of Object.entries(permissions)) {
      if (STORED_PERMISSIONS.has(permission) && (state === "allow" || state === "deny"))
        next[permission] = state;
    }
    if (Object.keys(next).length) record[origin] = next;
  }
  return record;
}

export function createEmbeddedBrowserSitePermissionController(deps: {
  load: () => Promise<unknown>;
  save: (record: SitePermissionRecord) => Promise<void>;
  sendPrompt: (hostId: number, prompt: EmbeddedBrowserSitePermissionPrompt) => boolean;
  timeoutMs?: number;
  onPromptClosed?: (hostId: number, requestId: string) => void;
  onChanged?: () => void;
}) {
  let record: SitePermissionRecord = Object.create(null);
  const sessionAllow = new Set<string>();
  const deviceGrants = new Set<string>();
  const choices = new Map<
    string,
    {
      hostId: number;
      finish: (id: string | null) => void;
    }
  >();
  const inflight = new Map<string, Promise<boolean>>();
  const pending = new Map<
    string,
    { hostId: number; finish: (action: SitePermissionAction) => void }
  >();
  let writes = Promise.resolve();
  let settingsRevision = 0;
  const keyFor = (origin: string, permission: string) => `${origin}\u0000${permission}`;

  function update(mutator: (next: SitePermissionRecord) => void): Promise<void> {
    const operation = writes.then(async () => {
      const next = cleanRecord(record);
      mutator(next);
      await deps.save(next);
      record = next;
      try {
        deps.onChanged?.();
      } catch {
        /* 投影通知失败不能改变已保存的授权结果。 */
      }
    });
    writes = operation.catch(() => undefined);
    return operation;
  }

  function invalidatePrompts(): void {
    settingsRevision += 1;
    for (const item of pending.values()) item.finish("dismiss");
    for (const item of choices.values()) item.finish(null);
  }

  return {
    async load(): Promise<void> {
      record = cleanRecord(await deps.load());
    },
    snapshot(): SitePermissionRecord {
      return structuredClone(record);
    },
    grantDevice(origin: string, type: string, id: string): void {
      deviceGrants.add(`${origin}\u0000${type}\u0000${id}`);
    },
    revokeDevice(origin: string, type: string, id: string): void {
      deviceGrants.delete(`${origin}\u0000${type}\u0000${id}`);
    },
    checkDevice(origin: string, type: string, id: string): boolean {
      return deviceGrants.has(`${origin}\u0000${type}\u0000${id}`);
    },
    choose(
      input: Omit<EmbeddedBrowserSitePermissionPrompt, "requestId" | "expiresAt"> & {
        hostId: number;
        choices: NonNullable<EmbeddedBrowserSitePermissionPrompt["choices"]>;
      },
    ) {
      const requestId = randomUUID();
      const expiresAt = Date.now() + (deps.timeoutMs ?? 20_000);
      let options = input.choices;
      let finish!: (id: string | null) => void;
      const result = new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => finish(null), deps.timeoutMs ?? 20_000);
        let settled = false;
        finish = (id) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          choices.delete(requestId);
          try {
            deps.onPromptClosed?.(input.hostId, requestId);
          } catch {
            /* 窗口销毁仍须结算。 */
          }
          resolve(id && options.some((option) => option.id === id) ? id : null);
        };
        choices.set(requestId, { hostId: input.hostId, finish });
      });
      const update = (next: typeof options) => {
        if (!choices.has(requestId)) return;
        options = next;
        try {
          if (
            !normalizeSitePermissionOrigin(input.origin) ||
            !deps.sendPrompt(input.hostId, {
              requestId,
              expiresAt,
              origin: input.origin,
              permission: input.permission,
              guestWebContentsId: input.guestWebContentsId,
              choices: options,
            })
          )
            finish(null);
        } catch {
          finish(null);
        }
      };
      update(options);
      return { result, update, cancel: () => finish(null) };
    },
    check(originOrUrl: string, permission: string, mediaType?: string): boolean {
      if (SILENT_ALLOW.has(permission)) return true;
      const origin = normalizeSitePermissionOrigin(originOrUrl);
      const capability = permission === "media" ? `media:${mediaType}` : permission;
      if (!origin || !STORED_PERMISSIONS.has(capability)) return false;
      const persisted = record[origin]?.[capability];
      return (
        persisted === "allow" ||
        (persisted !== "deny" && sessionAllow.has(keyFor(origin, capability)))
      );
    },
    async set(
      origin: string,
      permission: string,
      state: SitePermissionState | "ask",
    ): Promise<void> {
      if (
        normalizeSitePermissionOrigin(origin) !== origin ||
        !STORED_PERMISSIONS.has(permission) ||
        (state !== "allow" && state !== "deny" && state !== "ask")
      )
        throw new Error("invalid site permission");
      sessionAllow.delete(keyFor(origin, permission));
      invalidatePrompts();
      await update((next) => {
        if (state === "ask") {
          delete next[origin]?.[permission];
          if (next[origin] && !Object.keys(next[origin]).length) delete next[origin];
        } else next[origin] = { ...next[origin], [permission]: state };
      });
    },
    async reset(origin: string): Promise<void> {
      if (normalizeSitePermissionOrigin(origin) !== origin) throw new Error("invalid site origin");
      invalidatePrompts();
      for (const key of deviceGrants)
        if (key.startsWith(`${origin}\u0000`)) deviceGrants.delete(key);
      for (const permission of STORED_PERMISSIONS) sessionAllow.delete(keyFor(origin, permission));
      await update((next) => {
        delete next[origin];
      });
    },
    async clear(): Promise<void> {
      sessionAllow.clear();
      deviceGrants.clear();
      invalidatePrompts();
      await update((next) => {
        for (const origin of Object.keys(next)) delete next[origin];
      });
    },
    request(
      url: string,
      permission: string,
      hostId: number,
      guestWebContentsId: number,
      mediaTypes?: string[],
    ): Promise<boolean> {
      const origin = normalizeSitePermissionOrigin(url);
      if (!origin || !PROMPTABLE.has(permission))
        return Promise.resolve(SILENT_ALLOW.has(permission));
      // Electron 的 media 同时覆盖摄像头和麦克风，必须按实际请求能力保存，避免授权升级。
      const capabilities =
        permission === "media"
          ? [...new Set(mediaTypes ?? [])].map((type) => `media:${type}`).sort()
          : [permission];
      if (!capabilities.length || capabilities.some((item) => !STORED_PERMISSIONS.has(item)))
        return Promise.resolve(false);
      if (capabilities.some((item) => record[origin]?.[item] === "deny"))
        return Promise.resolve(false);
      if (capabilities.every((item) => this.check(origin, item))) return Promise.resolve(true);
      // 同一窗口同站点的重复请求共享决策；不同窗口各自确认，防止跨窗口误批准。
      const key = `${hostId}\u0000${keyFor(origin, capabilities.join(","))}`;
      const existing = inflight.get(key);
      if (existing) return existing;
      const requestId = randomUUID();
      const requestRevision = settingsRevision;
      const result = new Promise<boolean>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => finish("dismiss"), deps.timeoutMs ?? 20_000);
        const finish = (action: SitePermissionAction) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pending.delete(requestId);
          try {
            deps.onPromptClosed?.(hostId, requestId);
          } catch {
            /* 窗口销毁仍需结算网页回调。 */
          }
          if (requestRevision !== settingsRevision) {
            resolve(false);
            return;
          }
          if (action === "allow-session") {
            for (const item of capabilities) sessionAllow.add(keyFor(origin, item));
            resolve(true);
          } else if (action === "allow-always") {
            void update((next) => {
              next[origin] = { ...next[origin] };
              for (const item of capabilities) next[origin]![item] = "allow";
            }).then(
              () => resolve(true),
              () => resolve(false),
            );
          } else resolve(false);
        };
        pending.set(requestId, { hostId, finish });
        try {
          if (
            !deps.sendPrompt(hostId, {
              requestId,
              origin,
              permission,
              guestWebContentsId,
              expiresAt: Date.now() + (deps.timeoutMs ?? 20_000),
              ...(mediaTypes ? { mediaTypes } : {}),
            })
          )
            finish("dismiss");
        } catch {
          finish("dismiss");
        }
      }).finally(() => inflight.delete(key));
      inflight.set(key, result);
      return result;
    },
    resolve(
      hostId: number,
      requestId: string,
      action: SitePermissionAction | "select",
      selectionId?: string,
    ): boolean {
      const choice = choices.get(requestId);
      if (choice) {
        if (choice.hostId !== hostId || (action !== "select" && action !== "dismiss")) return false;
        choice.finish(action === "select" ? (selectionId ?? null) : null);
        return true;
      }
      const item = pending.get(requestId);
      if (
        !item ||
        item.hostId !== hostId ||
        !["allow-always", "allow-session", "dismiss"].includes(action)
      )
        return false;
      if (action === "select") return false;
      item.finish(action);
      return true;
    },
  };
}

export type EmbeddedBrowserSitePermissionController = ReturnType<
  typeof createEmbeddedBrowserSitePermissionController
>;

let activeController: EmbeddedBrowserSitePermissionController | null = null;
export function setActiveEmbeddedBrowserSitePermissionController(
  controller: EmbeddedBrowserSitePermissionController,
): void {
  activeController = controller;
}
export function getActiveEmbeddedBrowserSitePermissionController(): EmbeddedBrowserSitePermissionController | null {
  return activeController;
}
