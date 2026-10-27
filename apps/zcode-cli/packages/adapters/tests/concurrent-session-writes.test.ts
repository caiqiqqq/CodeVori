import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStore } from "../src/storage/session-store/sqlite-session-store.js";
import type { SessionId, MessageId, PartId, ProjectId } from "@zcode/contracts";

test("overlapping promotions keep each transcript and ledger atomic, including rollback", async () => {
 const dir=await mkdtemp(join(tmpdir(),"zcode-concurrent-write-"));
 const store=new SqliteSessionStore({dbPath:join(dir,"session.db")});
 const ids=["session-a","session-b"] as SessionId[];
 const promotion=(sessionID:SessionId,broken=false)=>({id:`input-${sessionID}`,sessionID,message:{id:`message-${sessionID}` as MessageId,sessionID,role:"user" as const,time:{created:1}},parts:[{id:`part-${sessionID}` as PartId,sessionID,messageID:(broken?"missing-message":`message-${sessionID}`) as MessageId,type:"text" as const,text:sessionID}]});
 try {
 for(const id of ids){await store.createSession({id,projectID:"fixture" as ProjectId,slug:id,directory:"/project",path:"/project/subdir",title:id,version:"1"});await store.saveSessionInput({id:`input-${id}`,sessionID:id,kind:"user",delivery:"startNow",payload:{text:id}});}
 const failed=await Promise.allSettled([store.promoteSessionInput(promotion(ids[0],true)),store.promoteSessionInput(promotion(ids[1]))]);
 assert.equal(failed[0].status,"rejected");assert.equal(failed[1].status,"fulfilled");
 assert.equal((await store.messages({sessionID:ids[0]})).length,0);
 assert.equal((await store.listSessionInputs({sessionID:ids[0]}))[0].status,"admitted");
 assert.equal((await store.messages({sessionID:ids[1]}))[0].parts[0].type,"text");
 assert.equal((await store.listSessionInputs({sessionID:ids[1]}))[0].status,"promoted");
 await store.promoteSessionInput(promotion(ids[0]));
 assert.equal((await store.messages({sessionID:ids[0]}))[0].parts.length,1);
 assert.equal((await store.getSession(ids[0]))?.path,"/project/subdir");
 } finally {store.close();await rm(dir,{recursive:true,force:true});}
});

test("concurrent shared imports and a cold reopen retain independent records and actual subdirectories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-concurrent-import-"));
  const dbPath = join(dir, "session.db");
  let store = new SqliteSessionStore({ dbPath });
  try {
    const ids = Array.from({ length: 16 }, (_, index) => `import-${index}` as SessionId);
    await Promise.all(ids.map((id) => store.commitSharedContextImportBundle({
      session: { id, projectID: "fixture" as ProjectId, directory: "/project", path: `/project/${id}`, slug: id, title: id, version: "1" },
      contextMessage: { info: { id: `message-${id}` as MessageId, sessionID: id, role: "user", source: "shared_context", visibility: "model-only", time: { created: 1 } }, parts: [{ id: `part-${id}` as PartId, messageID: `message-${id}` as MessageId, sessionID: id, type: "text", text: `context-${id}` }] },
      provenance: { id: `provenance-${id}`, sessionID: id, type: "v4/shared_context_import", time: { created: 1, updated: 1 }, data: { contextId: `context-${id}`, status: "pending" } },
    })));
    store.close();
    store = new SqliteSessionStore({ dbPath });
    for (const id of ids) {
      const session = await store.getSession(id);
      assert.equal(session?.directory, "/project");
      assert.equal(session?.path, `/project/${id}`);
      const messages = await store.messages({ sessionID: id });
      assert.equal(messages.length, 1);
      assert.equal(messages[0].info.sessionID, id);
      assert.equal(messages[0].parts.length, 1);
      assert.equal(messages[0].parts[0].sessionID, id);
    }
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
