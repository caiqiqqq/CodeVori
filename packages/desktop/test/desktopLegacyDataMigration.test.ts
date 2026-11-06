import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  isLegacyDesktopProfileRunning,
  migrateLegacyDesktopData,
} from "../src/main/desktopLegacyDataMigration.ts";

test("first launch copies ZCode data and profile once, then both products write independently", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-migrate-"));
  const legacyDataRoot = join(root, ".zcode");
  const productDataRoot = join(root, ".codevori");
  const legacyProfile = join(root, "ZCode");
  const productProfile = join(root, "CodeVori");
  const oldWorkspace = join(legacyDataRoot, "workspace", "default");
  const newWorkspace = join(productDataRoot, "workspace", "default");
  try {
    await mkdir(join(legacyDataRoot, "v2"), { recursive: true });
    await mkdir(join(legacyDataRoot, "cli", "memories"), { recursive: true });
    await mkdir(join(legacyDataRoot, "v2", "certs"), { recursive: true });
    await mkdir(join(legacyDataRoot, "computer-use"), { recursive: true });
    await mkdir(join(legacyProfile, "session"), { recursive: true });
    await writeFile(
      join(legacyDataRoot, "v2", "setting.json"),
      JSON.stringify({
        locale: "zh-CN",
        lastWorkspaceSession: { window: { workspacePath: oldWorkspace } },
      }),
    );
    await writeFile(join(legacyDataRoot, "cli", "memories", "fact.md"), "original");
    await writeFile(join(legacyDataRoot, "v2", "certs", "zcode-network-ca.key"), "old key");
    await writeFile(join(legacyDataRoot, "computer-use", "old-helper"), "old helper");
    await writeFile(join(legacyProfile, "session", "Cookies"), "cookie-data");
    await symlink(`host-${process.pid}`, join(legacyProfile, "SingletonLock"));

    const blocked = await migrateLegacyDesktopData({
      legacyDataRoots: [{ source: legacyDataRoot, target: productDataRoot }],
      legacyProfile,
      productProfile,
      isLegacyRunning: async () => true,
    });
    assert.equal(blocked, "legacy-running");
    assert.deepEqual(await readdir(root), [".zcode", "ZCode"]);

    const migrated = await migrateLegacyDesktopData({
      legacyDataRoots: [{ source: legacyDataRoot, target: productDataRoot }],
      legacyProfile,
      productProfile,
      isLegacyRunning: async () => false,
    });
    assert.equal(migrated, "migrated");
    assert.equal(
      JSON.parse(await readFile(join(productDataRoot, "v2", "setting.json"), "utf8"))
        .lastWorkspaceSession.window.workspacePath,
      newWorkspace,
    );
    assert.equal(
      await readFile(join(productDataRoot, "cli", "memories", "fact.md"), "utf8"),
      "original",
    );
    assert.ok(!(await readdir(join(productDataRoot, "v2"))).includes("certs"));
    assert.ok(!(await readdir(productDataRoot)).includes("computer-use"));
    assert.equal(await readFile(join(productProfile, "session", "Cookies"), "utf8"), "cookie-data");
    assert.ok(!(await readdir(productProfile)).includes("SingletonLock"));

    await writeFile(join(productDataRoot, "cli", "memories", "fact.md"), "codevori");
    assert.equal(
      await migrateLegacyDesktopData({
        legacyDataRoots: [{ source: legacyDataRoot, target: productDataRoot }],
        legacyProfile,
        productProfile,
        isLegacyRunning: async () => true,
      }),
      "already-current",
    );
    assert.equal(
      await readFile(join(legacyDataRoot, "cli", "memories", "fact.md"), "utf8"),
      "original",
    );
    assert.equal(
      await readFile(join(productDataRoot, "cli", "memories", "fact.md"), "utf8"),
      "codevori",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy profile lock reports the live owner and ignores a stale pid", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-legacy-lock-"));
  try {
    await symlink(`host-${process.pid}`, join(root, "SingletonLock"));
    assert.equal(await isLegacyDesktopProfileRunning(root), true);
    await rm(join(root, "SingletonLock"));
    await symlink("host-99999999", join(root, "SingletonLock"));
    assert.equal(await isLegacyDesktopProfileRunning(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second CodeVori launch waits for the first migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-migrate-lock-"));
  const migrationLock = join(root, "CodeVori.migration-lock");
  try {
    await mkdir(migrationLock);
    await writeFile(join(migrationLock, "pid"), String(process.pid));
    assert.equal(
      await migrateLegacyDesktopData({
        legacyDataRoots: [{ source: join(root, ".zcode"), target: join(root, ".codevori") }],
        legacyProfile: join(root, "ZCode"),
        productProfile: join(root, "CodeVori"),
        migrationLock,
      }),
      "migration-running",
    );
    assert.deepEqual(await readdir(root), ["CodeVori.migration-lock"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an interrupted migration resumes custom data root without replacing copied settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-migrate-resume-"));
  const legacyHome = join(root, "home", ".zcode");
  const productHome = join(root, "home", ".codevori");
  const legacyCustom = join(root, "custom", ".zcode");
  const productCustom = join(root, "custom", ".codevori");
  const legacyProfile = join(root, "ZCode");
  const productProfile = join(root, "CodeVori");
  try {
    await mkdir(productHome, { recursive: true });
    await mkdir(legacyCustom, { recursive: true });
    await mkdir(legacyProfile, { recursive: true });
    await writeFile(
      join(productHome, ".migration-from-zcode.json"),
      '{"version":1,"status":"pending"}',
    );
    await writeFile(join(productHome, "settings.json"), "already copied");
    await writeFile(join(legacyCustom, "tasks.sqlite"), "custom history");
    const result = await migrateLegacyDesktopData({
      legacyDataRoots: [
        { source: legacyHome, target: productHome },
        { source: legacyCustom, target: productCustom },
      ],
      legacyProfile,
      productProfile,
      isLegacyRunning: async () => false,
    });
    assert.equal(result, "migrated");
    assert.equal(await readFile(join(productHome, "settings.json"), "utf8"), "already copied");
    assert.equal(await readFile(join(productCustom, "tasks.sqlite"), "utf8"), "custom history");
    assert.match(
      await readFile(join(productHome, ".migration-from-zcode.json"), "utf8"),
      /complete/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing CodeVori settings keep precedence while old default workspace records move", async () => {
  const root = await mkdtemp(join(tmpdir(), "codevori-migrate-existing-"));
  const legacyDataRoot = join(root, ".zcode");
  const productDataRoot = join(root, ".codevori");
  const oldWorkspace = join(legacyDataRoot, "workspace", "default");
  const newWorkspace = join(productDataRoot, "workspace", "default");
  try {
    await mkdir(join(legacyDataRoot, "v2"), { recursive: true });
    await mkdir(join(legacyDataRoot, "cli", "db"), { recursive: true });
    await mkdir(oldWorkspace, { recursive: true });
    await mkdir(join(productDataRoot, "v2"), { recursive: true });
    await writeFile(join(oldWorkspace, "note.txt"), "legacy workspace");
    await writeFile(
      join(productDataRoot, "v2", "setting.json"),
      JSON.stringify({ locale: "en-US" }),
    );
    await writeFile(
      join(legacyDataRoot, "v2", "setting.json"),
      JSON.stringify({
        locale: "zh-CN",
        lastWorkspaceSession: { window: { workspacePath: oldWorkspace } },
      }),
    );

    const taskDb = new DatabaseSync(join(legacyDataRoot, "v2", "tasks-index.sqlite"));
    taskDb.exec(
      "CREATE TABLE tasks (workspace_key TEXT, workspace_path TEXT, task_id TEXT, root_path TEXT, meta_json TEXT)",
    );
    taskDb
      .prepare("INSERT INTO tasks VALUES (?, ?, 'task-1', ?, ?)")
      .run(
        oldWorkspace,
        oldWorkspace,
        oldWorkspace,
        JSON.stringify({ workspacePath: oldWorkspace, title: "keep title" }),
      );
    taskDb.close();
    const cliDb = new DatabaseSync(join(legacyDataRoot, "cli", "db", "db.sqlite"));
    cliDb.exec("CREATE TABLE session (directory TEXT, path TEXT)");
    cliDb.prepare("INSERT INTO session VALUES (?, ?)").run(oldWorkspace, oldWorkspace);
    cliDb.close();

    assert.equal(
      await migrateLegacyDesktopData({
        legacyDataRoots: [{ source: legacyDataRoot, target: productDataRoot }],
        legacyProfile: join(root, "ZCode"),
        productProfile: join(root, "CodeVori"),
        isLegacyRunning: async () => false,
      }),
      "migrated",
    );
    assert.equal(await readFile(join(newWorkspace, "note.txt"), "utf8"), "legacy workspace");
    assert.deepEqual(
      JSON.parse(await readFile(join(productDataRoot, "v2", "setting.json"), "utf8")),
      { locale: "en-US" },
    );
    const migratedTaskDb = new DatabaseSync(join(productDataRoot, "v2", "tasks-index.sqlite"));
    assert.deepEqual(
      {
        ...migratedTaskDb
          .prepare("SELECT workspace_key, workspace_path, root_path FROM tasks")
          .get(),
      },
      {
        workspace_key: newWorkspace,
        workspace_path: newWorkspace,
        root_path: newWorkspace,
      },
    );
    assert.equal(
      JSON.parse(String(migratedTaskDb.prepare("SELECT meta_json FROM tasks").get()?.meta_json))
        .workspacePath,
      newWorkspace,
    );
    migratedTaskDb.close();
    const migratedCliDb = new DatabaseSync(join(productDataRoot, "cli", "db", "db.sqlite"));
    assert.deepEqual(
      { ...migratedCliDb.prepare("SELECT directory, path FROM session").get() },
      {
        directory: newWorkspace,
        path: newWorkspace,
      },
    );
    migratedCliDb.close();
    assert.equal(
      await readFile(join(legacyDataRoot, "v2", "setting.json"), "utf8").then(
        (value) => JSON.parse(value).locale,
      ),
      "zh-CN",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
