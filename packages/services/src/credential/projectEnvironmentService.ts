import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Emitter, Event } from "@zcode/rpc";
import {
  resolveWorkspaceKey,
  projectEnvironmentScopeSchema,
  projectEnvironmentSessionSchema,
  saveProjectEnvironmentSchema,
  setSessionEnvironmentSchema,
  type ProjectEnvironment,
  type ProjectEnvironmentScope,
  type ProjectEnvironmentSession,
  type ResolvedProjectEnvironment,
} from "@zcode/shared";
import type { CredentialVaultEntry } from "./credential.js";
import type { ProjectEnvironmentService } from "./projectEnvironment.js";
import { ProjectEnvironmentRepository } from "./projectEnvironmentRepository.js";

const deleteSchema = projectEnvironmentScopeSchema.extend({
  id: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
});
const sessionKey = (scope: ProjectEnvironmentSession) =>
  JSON.stringify([resolveWorkspaceKey(scope), scope.kind, scope.sessionId]);

export function createProjectEnvironmentService(options: {
  databasePath: string;
  listCredentials(): Promise<CredentialVaultEntry[]>;
  assertSessionIdle(scope: ProjectEnvironmentSession): Promise<void>;
}): ProjectEnvironmentService & {
  dispose(): void;
  beginInput(scope: ProjectEnvironmentSession): () => void;
} {
  const repo = new ProjectEnvironmentRepository(options.databasePath);
  const changed = new Emitter<string>();
  const queues = new Map<string, Promise<unknown>>();
  const admissions = new Map<string, number>();
  const owned = (
    profile: ProjectEnvironment | null,
    scope: ProjectEnvironmentScope,
  ): ProjectEnvironment => {
    if (!profile || resolveWorkspaceKey(profile) !== resolveWorkspaceKey(scope))
      throw new Error("environment.unavailable");
    return profile;
  };
  const resolve = async (profile: ProjectEnvironment): Promise<ResolvedProjectEnvironment> => {
    const key = resolveWorkspaceKey(profile);
    const credentials = (await options.listCredentials()).filter(
      (entry) => entry.workspaceIdentity === null || entry.workspaceIdentity === key,
    );
    return {
      ...profile,
      resources: profile.resources.map((resource) => {
        const entry = credentials.find((credential) => credential.id === resource.credentialId);
        return {
          ...resource,
          credential: entry
            ? {
                id: entry.id,
                name: entry.name,
                kind: entry.kind,
                environment: entry.environment,
                host: entry.host,
                port: entry.port,
                username: entry.username,
              }
            : null,
        };
      }),
    };
  };
  const service: ProjectEnvironmentService & {
    dispose(): void;
    beginInput(scope: ProjectEnvironmentSession): () => void;
  } = {
    beginInput(scope) {
      const key = sessionKey(projectEnvironmentSessionSchema.parse(scope));
      admissions.set(key, (admissions.get(key) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = (admissions.get(key) ?? 1) - 1;
        if (remaining) admissions.set(key, remaining);
        else admissions.delete(key);
      };
    },
    async listProjectEnvironments(rawScope) {
      const scope = projectEnvironmentScopeSchema.parse(rawScope);
      await repo.ready();
      return repo.list(resolveWorkspaceKey(scope));
    },
    async saveProjectEnvironment(raw) {
      const input = saveProjectEnvironmentSchema.parse(raw);
      await repo.ready();
      const key = resolveWorkspaceKey(input);
      const existing = input.id ? repo.find(input.id) : null;
      if (existing) owned(existing, input);
      const credentials = await options.listCredentials();
      for (const resource of input.resources) {
        // 已失效的旧引用可保留供修复；新引用不能越过凭证自身的授权范围。
        const unchanged = existing?.resources.some(
          (old) => old.credentialId === resource.credentialId,
        );
        if (
          !unchanged &&
          !credentials.some(
            (entry) =>
              entry.id === resource.credentialId &&
              (entry.workspaceIdentity === null || entry.workspaceIdentity === key),
          )
        )
          throw new Error("environment.credential-unavailable");
      }
      const { expectedRevision, ...fields } = input;
      const now = Date.now();
      const saved: ProjectEnvironment = {
        ...fields,
        id: input.id ?? randomUUID(),
        revision: expectedRevision + 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      repo.save(saved, key, expectedRevision);
      changed.fire(key);
      return saved;
    },
    async deleteProjectEnvironment(raw) {
      const input = deleteSchema.parse(raw);
      await repo.ready();
      const key = resolveWorkspaceKey(input);
      const current = owned(repo.find(input.id), input);
      repo.remove(input.id, key, input.expectedRevision);
      changed.fire(resolveWorkspaceKey(current));
    },
    async readProjectEnvironment(raw) {
      const input = projectEnvironmentScopeSchema.extend({ id: z.string().uuid() }).parse(raw);
      await repo.ready();
      return resolve(owned(repo.find(input.id), input));
    },
    async getSessionEnvironment(raw) {
      const scope = projectEnvironmentSessionSchema.parse(raw);
      await repo.ready();
      const binding = repo.binding(sessionKey(scope));
      const profile = binding.environmentId ? repo.find(binding.environmentId) : null;
      // 已选档案被编辑或删除后，不把运行中的任务悄悄指向另一版资源。
      const available =
        profile &&
        profile.revision === binding.environmentRevision &&
        resolveWorkspaceKey(profile) === resolveWorkspaceKey(scope);
      return { ...binding, environment: available ? await resolve(profile) : null };
    },
    async setSessionEnvironment(raw) {
      const input = setSessionEnvironmentSchema.parse(raw);
      const key = sessionKey(input);
      const next = (queues.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          await repo.ready();
          await options.assertSessionIdle(input);
          // 输入 admission 与环境写入共享 Host JS 所有者；异步 idle 检查期间进入的新输入必须阻止改绑。
          if (admissions.get(key)) throw new Error("environment.session-busy");
          const profile = input.environmentId ? owned(repo.find(input.environmentId), input) : null;
          repo.bind(
            key,
            {
              revision: input.expectedRevision + 1,
              environmentId: input.environmentId,
              environmentRevision: profile?.revision ?? null,
            },
            input.expectedRevision,
          );
          changed.fire(resolveWorkspaceKey(input));
          return service.getSessionEnvironment({
            workspacePath: input.workspacePath,
            ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
            kind: input.kind,
            sessionId: input.sessionId,
          });
        });
      queues.set(key, next);
      try {
        return await next;
      } finally {
        if (queues.get(key) === next) queues.delete(key);
      }
    },
    onDynamicProjectEnvironmentsChanged(raw) {
      const key = resolveWorkspaceKey(projectEnvironmentScopeSchema.parse(raw));
      return Event.map(
        Event.filter(changed.event, (value) => value === key),
        () => undefined,
      );
    },
    dispose() {
      repo.close();
      changed.dispose();
    },
  };
  return service;
}
