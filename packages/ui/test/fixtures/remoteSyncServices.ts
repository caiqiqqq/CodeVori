export function createRemoteSyncFixture(events: unknown[]) {
  let stage: string | undefined, release: (() => void) | undefined;
  const wait = async (step: string) => {
    if (stage !== step) return;
    events.push(["sync-paused", step]);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    events.push(["sync-resolved", step]);
  };
  return {
    control: {
      gate(step: string) {
        stage = step;
      },
      release() {
        release?.();
        stage = undefined;
      },
    },
    services: {
      mcpSyncService: {
        listLocalUserMcpCandidates: async () => {
          events.push(["mcp-candidates"]);
          return {
            candidates: [
              {
                id: "user:fixture",
                name: "fixture-sync",
                enabled: true,
                source: "user",
                path: "/local/mcp.json",
                config: { command: "node" },
              },
            ],
            localHomeDir: "/local",
          };
        },
        listRemoteUserMcpStatuses: async (scope: unknown) => {
          events.push(["mcp-remote", scope]);
          return { statuses: [], remoteHomeDir: "/remote" };
        },
        checkRemoteUserMcpWriteAccess: async () => {
          await wait("mcp-preflight");
          return { ok: true, path: "/remote/mcp.json" };
        },
        exportMcpServers: async (scope: unknown) => {
          events.push(["mcp-export", scope]);
          await wait("mcp-export");
          return {
            servers: [{ name: "fixture-sync", config: { command: "node" } }],
            localHomeDir: "/local",
          };
        },
        importMcpServers: async (scope: unknown) => {
          events.push(["mcp-import", scope]);
          return {
            results: [{ name: "fixture-sync", status: "synced", path: "/remote/mcp.json" }],
          };
        },
      },
      skillSyncService: {
        listLocalUserSkillCandidates: async () => ({
          candidates: [
            {
              id: "skill:fixture",
              directoryName: "fixture-sync",
              name: "fixture-sync",
              description: "Fixture skill",
              path: "/local/skills/fixture",
              source: "user",
            },
          ],
        }),
        listRemoteUserSkillStatuses: async () => ({ statuses: [] }),
        checkRemoteUserSkillWriteAccess: async () => {
          await wait("skill-preflight");
          return { ok: true, path: "/remote/skills" };
        },
        exportSkillsArchive: async (scope: unknown) => {
          events.push(["skill-export", scope]);
          await wait("skill-export");
          return { archive: "fixture" };
        },
        importSkillsArchive: async (scope: unknown) => {
          events.push(["skill-import", scope]);
          return { results: [{ directoryName: "fixture-sync", status: "synced" }] };
        },
      },
    },
  };
}
