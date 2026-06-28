import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { createPool, sql, withRlsTransaction } from "../src/client.js";
import { env } from "../src/env.js";

/**
 * Module 9 (knowledge) — DATABASE-level proofs (CLAUDE.md §3 visibility/tenancy,
 * §3.4 grants; SCHEMA m-knowledge + 0019). Fixtures built via the admin/superuser
 * connection (bypasses RLS); assertions run via the app role (RLS + grants
 * ENFORCED). Mirrors billing-rls.test.ts.
 *
 * Proves:
 *   • tenant isolation: knowledge_article / cover_sheet_template / file_object
 *     inserted in org A are invisible from an org-B-scoped tx (zero rows),
 *     visible from org A.
 *   • grants: DELETE on knowledge_article is denied (no delete grant — articles
 *     archive, never hard-delete); DELETE on knowledge_attachment is allowed.
 */

const admin = new pg.Client({ connectionString: env.adminUrl });
const appPool = createPool(env.appUrl);

const orgA = randomUUID();
const orgB = randomUUID();

const fileA = randomUUID();
const articleA = randomUUID();
const attachmentA = randomUUID();
const coverA = randomUUID();
// org B
const fileB = randomUUID();
const articleB = randomUUID();
const coverB = randomUUID();

before(async () => {
  await admin.connect();
  await admin.query("insert into org (id, name) values ($1,'M9 Org A'),($2,'M9 Org B')", [orgA, orgB]);

  // org A content
  await admin.query(
    "insert into file_object (id, org_id, kind, is_link, url, filename, mime, size_bytes) values ($1,$2,'knowledge',false,$3,'a.txt','text/plain',10)",
    [fileA, orgA, randomUUID()],
  );
  await admin.query(
    "insert into knowledge_article (id, org_id, type, title) values ($1,$2,'doc','Org A doc')",
    [articleA, orgA],
  );
  await admin.query(
    "insert into knowledge_attachment (id, org_id, article_id, file_object_id) values ($1,$2,$3,$4)",
    [attachmentA, orgA, articleA, fileA],
  );
  await admin.query(
    "insert into cover_sheet_template (id, org_id, name) values ($1,$2,'Org A cover')",
    [coverA, orgA],
  );

  // org B content (tenant isolation)
  await admin.query(
    "insert into file_object (id, org_id, kind, is_link, url) values ($1,$2,'knowledge',true,'https://b.example/x')",
    [fileB, orgB],
  );
  await admin.query("insert into knowledge_article (id, org_id, type, title) values ($1,$2,'blog','Org B blog')", [articleB, orgB]);
  await admin.query("insert into cover_sheet_template (id, org_id, name) values ($1,$2,'Org B cover')", [coverB, orgB]);
});

after(async () => {
  for (const org of [orgA, orgB]) {
    await admin.query("delete from knowledge_attachment where org_id=$1", [org]);
    await admin.query("delete from knowledge_article where org_id=$1", [org]);
    await admin.query("delete from cover_sheet_template where org_id=$1", [org]);
    await admin.query("delete from file_object where org_id=$1", [org]);
    await admin.query("delete from org where id=$1", [org]);
  }
  await admin.end();
  await appPool.end();
});

// ─── Tenant isolation ──────────────────────────────────────────────────────────

async function countArticle(orgId: string, id: string): Promise<number> {
  return withRlsTransaction(appPool, { orgId, partyId: null, isSuperadmin: true }, async (tx) => {
    const res = await tx.execute(sql`select count(*)::int as n from knowledge_article where id = ${id}`);
    return (res.rows[0] as { n: number }).n;
  });
}
async function countCover(orgId: string, id: string): Promise<number> {
  return withRlsTransaction(appPool, { orgId, partyId: null, isSuperadmin: true }, async (tx) => {
    const res = await tx.execute(sql`select count(*)::int as n from cover_sheet_template where id = ${id}`);
    return (res.rows[0] as { n: number }).n;
  });
}
async function countFile(orgId: string, id: string): Promise<number> {
  return withRlsTransaction(appPool, { orgId, partyId: null, isSuperadmin: true }, async (tx) => {
    const res = await tx.execute(sql`select count(*)::int as n from file_object where id = ${id}`);
    return (res.rows[0] as { n: number }).n;
  });
}

describe("tenant isolation — knowledge_article", () => {
  it("org A sees its own article", async () => {
    assert.equal(await countArticle(orgA, articleA), 1);
  });
  it("🔴 org B context sees ZERO rows for org A's article", async () => {
    assert.equal(await countArticle(orgB, articleA), 0, "another tenant's article must be invisible");
  });
});

describe("tenant isolation — cover_sheet_template", () => {
  it("org A sees its own cover sheet", async () => {
    assert.equal(await countCover(orgA, coverA), 1);
  });
  it("🔴 org B context sees ZERO rows for org A's cover sheet", async () => {
    assert.equal(await countCover(orgB, coverA), 0, "another tenant's cover sheet must be invisible");
  });
});

describe("tenant isolation — file_object", () => {
  it("org A sees its own file", async () => {
    assert.equal(await countFile(orgA, fileA), 1);
  });
  it("🔴 org B context sees ZERO rows for org A's file", async () => {
    assert.equal(await countFile(orgB, fileA), 0, "another tenant's file must be invisible");
  });
});

// ─── Grants (the append/archive policy for the app role) ─────────────────────────

describe("grants — knowledge_article archives, never hard-deletes", () => {
  it("DELETE on knowledge_article → permission denied (no delete grant)", async () => {
    await assert.rejects(
      withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
        await tx.execute(sql`delete from knowledge_article where id = ${articleA}`);
      }),
      /permission denied/i,
      "articles must not be hard-deletable by the app role",
    );
  });
});

describe("grants — knowledge_attachment can be removed (the join row)", () => {
  it("DELETE on knowledge_attachment → allowed", async () => {
    const id = randomUUID();
    // insert a throwaway attachment via the app role, then delete it via the app role.
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`
        insert into knowledge_attachment (id, org_id, article_id, file_object_id)
        values (${id}, ${orgA}, ${articleA}, ${fileA})
      `);
    });
    await withRlsTransaction(appPool, { orgId: orgA, partyId: null, isSuperadmin: true }, async (tx) => {
      await tx.execute(sql`delete from knowledge_attachment where id = ${id}`);
    });
    const { rows } = await admin.query("select 1 from knowledge_attachment where id=$1", [id]);
    assert.equal(rows.length, 0, "the join row was removed");
  });
});
