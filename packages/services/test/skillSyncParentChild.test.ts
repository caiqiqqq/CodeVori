import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillSyncService } from "../src/skill-sync/skillSyncService.js";

for (const selected of ["parent", "child", "both"] as const) {
  test(`skill sync exports ${selected} without losing parent or child`, async () => {
    const home = await mkdtemp(join(tmpdir(), "zcode-skill-sync-"));
    const previous = process.env.HOME;
    process.env.HOME = home;
    try {
      const parent = join(home, ".zcode", "skills", "parent");
      const child = join(parent, "child");
      await mkdir(child, { recursive: true });
      await writeFile(
        join(parent, "SKILL.md"),
        "---\nname: parent\ndescription: parent\n---\nparent",
      );
      await writeFile(join(child, "SKILL.md"), "---\nname: child\ndescription: child\n---\nchild");
      const service = createSkillSyncService();
      const candidates = (await service.listLocalUserSkillCandidates()).candidates;
      const names = selected === "both" ? ["parent", "child"] : [selected];
      const ids = candidates.filter((item) => names.includes(item.name)).map((item) => item.id);
      assert.equal(ids.length, names.length);
      const exported = await service.exportSkillsArchive({ skillIds: ids });
      if (selected === "both") {
        const parentOnly = await service.exportSkillsArchive({
          skillIds: [candidates.find((item) => item.name === "parent")!.id],
        });
        assert.deepEqual(
          exported.archive,
          parentOnly.archive,
          "parent and child must be archived only once",
        );
      }
      const target = join(home, "remote");
      await mkdir(target);
      const previousImportHome = process.env.HOME;
      process.env.HOME = target;
      try {
        await createSkillSyncService().importSkillsArchive({ archive: exported.archive });
      } finally {
        process.env.HOME = previousImportHome;
      }
      if (selected !== "child")
        assert.match(
          await readFile(join(target, ".zcode", "skills", "parent", "SKILL.md"), "utf8"),
          /parent/,
        );
      assert.match(
        await readFile(join(target, ".zcode", "skills", "parent", "child", "SKILL.md"), "utf8"),
        /child/,
      );
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
      await rm(home, { recursive: true, force: true });
    }
  });
}
