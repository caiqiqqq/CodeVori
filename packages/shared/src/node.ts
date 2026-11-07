/**
 * Node-only shared utilities.
 *
 * This subpath must not be imported by renderer/browser bundles.
 */
export { acquireFileLock } from "./node/atomicFileLock.js";
export { prepareProductPaths, migrateLegacyScratchRoot } from "./node/productPathMigration.js";
export { resolveAppSettingsPaths, prepareAppSettingsFile } from "./node/appSettingsFile.js";
export { openProjectMemoryStore, projectMemoryRootValidator } from "./node/projectMemoryStore.js";
export { saveProjectMemories, type ProjectMemoryCandidate } from "./node/projectMemoryWriter.js";
export { readProjectMemoryFileFromStableHandle } from "./node/projectMemoryStableRead.js";
export {
  containsProjectMemorySecret,
  redactProjectMemorySecrets,
} from "./node/projectMemorySecrets.js";
export {
  resolveProjectMemoryRoot,
  resolveProjectMemoryScope,
  buildProjectMemoryInstructions,
  type ProjectMemoryRootInput,
  type ProjectMemoryScope,
  PROJECT_MEMORY_INDEX_LINE_LIMIT,
  PROJECT_MEMORY_INDEX_CHARACTER_LIMIT,
} from "./node/projectMemory.js";
export {
  prepareProjectMemoryScope,
  PROJECT_MEMORY_METADATA_FILE,
  PROJECT_MEMORY_MIGRATION_MARKER,
} from "./node/projectMemoryMigration.js";
export { scanOfficialPluginCacheRoots } from "./node/officialPluginCache.js";
export {
  migrateUserSubagentMarkdown,
  migrateSubagentStateFile,
} from "./node/subagentMarkdownMigration.js";
export {
  atomicWritePrivateTextFile,
  backupCorruptFile,
  withFileLock,
  type SharedFileLockOptions,
} from "./node/privateFilePersistence.js";
export {
  createNodeSelfResourceSampler,
  NODE_SELF_RESOURCE_SAMPLE_INTERVAL_MS,
  type NodeSelfResourceSampler,
  type NodeSelfResourceSamplerOptions,
} from "./node/nodeSelfResourceTelemetry.js";
