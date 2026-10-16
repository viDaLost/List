import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// Exercise the real route implementations against SQLite, without a web server.
// Only the platform's identity, D1 binding adapter and object store are replaced.
const root = process.cwd(), out = path.join(root, ".sites-runtime/test-build");
await mkdir(out, { recursive: true });
const files = [
  "lib/article.ts", "lib/reading.ts", "lib/server.ts", "lib/operations.ts", "app/components/article-view.tsx", "app/components/interactive-blocks.tsx", "app/components/reader-experience.tsx", "app/components/editor.tsx",
  "app/api/articles/route.ts", "app/api/articles/[id]/route.ts", "app/api/slug/route.ts",
  "app/api/uploads/route.ts", "app/media/[id]/route.ts", "app/api/views/[id]/route.ts",
  "app/api/admin/route.ts", "app/api/admin/backups/[id]/route.ts", "app/api/reports/route.ts",
];
await writeFile(path.join(out, "platform.mjs"), "export const env = globalThis.__listEnv;\n");
await writeFile(path.join(out, "auth.mjs"), "export async function getChatGPTUser() { return globalThis.__listUser; }\n");
for (const file of files) {
  let source = await readFile(path.join(root, file), "utf8");
  source = source.replace(/from (["'])([^"']+)\1/g, (all, quote, name) => {
    let target;
    if (name === "cloudflare:workers") target = path.join(out, "platform.mjs");
    else if (name === "@/app/chatgpt-auth") target = path.join(out, "auth.mjs");
    else if (name.startsWith("@/")) target = path.join(out, name.slice(2) + ".mjs");
    else if (name.startsWith(".")) target = path.resolve(out, path.dirname(file), name + ".mjs");
    return target ? "from " + quote + pathToFileURL(target).href + quote : all;
  });
  const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const target = path.join(out, file.replace(/\.tsx?$/, ".mjs"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, compiled);
}
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys = ON");
for (const file of (await readdir(path.join(root, "drizzle"))).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(await readFile(path.join(root, "drizzle", file), "utf8"));
function statement(sql) {
  let params = [];
  return {
    bind(...values) { params = values; return this; },
    async first() { return sqlite.prepare(sql).get(...params) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...params) }; },
    async run() { const result = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(result.changes) } }; },
  };
}
const objects = new Map();
globalThis.__listEnv = {
  LIST_ADMIN_EMAILS: "owner@example.test",
  DB: {
    prepare: statement,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = []; for (const stmt of statements) results.push(await stmt.run()); sqlite.exec("COMMIT"); return results; }
      catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  },
  BUCKET: {
    async put(id, bytes, options) { objects.set(id, { bytes: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, ...options }); },
    async delete(id) { objects.delete(id); },
    async get(id) { const object = objects.get(id); return object ? { body: object.bytes, httpEtag: '"test"', async json() { return JSON.parse(new TextDecoder().decode(object.bytes)); }, writeHttpMetadata(headers) { headers.set("Content-Type", object.httpMetadata.contentType); } } : null; },
  },
};
globalThis.__listUser = null;
const load = (file) => import(pathToFileURL(path.join(out, file + ".mjs")).href);
const collection = await load("app/api/articles/route"), item = await load("app/api/articles/[id]/route");
const slug = await load("app/api/slug/route"), upload = await load("app/api/uploads/route"), media = await load("app/media/[id]/route");
const views = await load("app/api/views/[id]/route"), model = await load("lib/article"), server = await load("lib/server");
const { ArticleView } = await load("app/components/article-view");
const reading = await load("lib/reading");
const { default: ReaderExperience } = await load("app/components/reader-experience");
const operations = await load("lib/operations"), adminApi = await load("app/api/admin/route"), reportApi = await load("app/api/reports/route"), backupApi = await load("app/api/admin/backups/[id]/route");
const { default: Editor } = await load("app/components/editor");
const owner = { userId: "owner", email: "owner@example.test" }, other = { userId: "other", email: "other@example.test" };
const req = (method, body, origin = model.SITE_ORIGIN) => new Request(model.SITE_ORIGIN + "/api/articles", { method, headers: { "content-type": "application/json", origin }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const context = (id) => ({ params: Promise.resolve({ id }) });
let article;

test("slugs accept readable Cyrillic paths and reject reserved or unsafe paths", () => {
  assert.equal(model.normalizeSlug(" /Vi/Моя-История/ "), "vi/моя-история");
  assert.equal(model.suggestSlug("Моя история"), "moya-istoriya");
  for (const value of ["api", "media/abc", "../x", "a//b", "https://evil.test", "a/b/c/d", "a?b"]) assert.throws(() => model.normalizeSlug(value));
});
test("unsafe links and malformed content cannot become executable HTML", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,x", "//evil.test", "https://user:pass@evil.test"]) assert.equal(model.safeUrl(value), "");
  assert.throws(() => model.normalizeArticle({ ...model.demoArticle(), blocks: [{ id: "x", type: "button", text: "x", url: "javascript:alert(1)" }] }));
  assert.throws(() => model.normalizeArticle({ ...model.demoArticle(), theme: "__proto__" }));
  const normalized = model.normalizeArticle({ ...model.demoArticle(), blocks: [{ id: "same", type: "paragraph", text: "<script>alert(1)</script> **safe**" }, { id: "same", type: "paragraph", text: "second" }] });
  assert.notEqual(normalized.blocks[0].id, normalized.blocks[1].id);
  const html = renderToStaticMarkup(createElement(ArticleView, { article: normalized }));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<strong>safe</strong>"));
});
test("anonymous write and account access are rejected", async () => {
  assert.equal((await collection.GET()).status, 401);
  assert.equal((await collection.POST(req("POST", model.demoArticle()))).status, 401);
});
test("draft creation, owner isolation, and hidden unpublished pages", async () => {
  globalThis.__listUser = owner;
  const response = await collection.POST(req("POST", model.demoArticle()));
  assert.equal(response.status, 201);
  article = (await response.json()).article;
  assert.equal(article.version, 1);
  assert.equal((await (await collection.GET()).json()).articles.length, 1);
  assert.equal(await server.publishedArticle(article.slug), null);
  globalThis.__listUser = other;
  assert.equal((await (await collection.GET()).json()).articles.length, 0);
  assert.equal((await item.PUT(req("PUT", article), context(article.id))).status, 404);
  assert.equal((await item.DELETE(req("DELETE"), context(article.id))).status, 404);
  globalThis.__listUser = owner;
});
test("a colliding URL rolls back the entire creation", async () => {
  const response = await collection.POST(req("POST", model.demoArticle()));
  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM articles").get().n, 1);
});
test("publishing, renaming, old URL resolution, and optimistic version checks", async () => {
  const response = await item.PUT(req("PUT", { ...article, slug: "vi/моя-история", published: true }), context(article.id));
  assert.equal(response.status, 200);
  const previous = article;
  article = (await response.json()).article;
  assert.equal(article.version, 2);
  assert.equal((await server.publishedArticle(previous.slug)).slug, article.slug);
  assert.equal((await server.publishedArticle(article.slug)).id, article.id);
  const stale = await item.PUT(req("PUT", { ...previous, title: "Must not overwrite", slug: "stale-url" }), context(article.id));
  assert.equal(stale.status, 409);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM paths WHERE slug='stale-url'").get().n, 0);
  assert.equal((await server.publishedArticle(article.slug)).title, article.title);
});
test("URL availability belongs only to the correct authenticated article owner", async () => {
  let response = await slug.GET(new Request(model.SITE_ORIGIN + "/api/slug?" + new URLSearchParams({ path: article.slug, id: article.id })));
  assert.equal((await response.json()).available, true);
  globalThis.__listUser = other;
  response = await slug.GET(new Request(model.SITE_ORIGIN + "/api/slug?" + new URLSearchParams({ path: article.slug, id: article.id })));
  assert.equal((await response.json()).available, false);
  globalThis.__listUser = owner;
});
test("cross-site writes and invalid JSON objects are rejected without changing records", async () => {
  assert.equal((await item.PUT(req("PUT", article, "https://evil.test"), context(article.id))).status, 403);
  assert.equal((await collection.POST(req("POST", null))).status, 400);
  assert.equal((await item.DELETE(req("DELETE", undefined, "https://evil.test"), context(article.id))).status, 403);
});
test("image signature checks, durable upload and correctly typed retrieval", async () => {
  const bad = new FormData(); bad.set("file", new File(["<svg><script>bad</script></svg>"], "fake.png", { type: "image/png" }));
  assert.equal((await upload.POST(new Request(model.SITE_ORIGIN + "/api/uploads", { method: "POST", body: bad }))).status, 400);
  const good = new FormData();
  good.set("file", new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=", "base64")], "pixel.png", { type: "image/png" }));
  const response = await upload.POST(new Request(model.SITE_ORIGIN + "/api/uploads", { method: "POST", body: good }));
  assert.equal(response.status, 201);
  const { url } = await response.json(), id = url.split("/").pop();
  const file = await media.GET(new Request(model.SITE_ORIGIN + url), context(id));
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.ok((await file.arrayBuffer()).byteLength > 8);
  globalThis.__listUser = null;
  assert.equal((await upload.POST(new Request(model.SITE_ORIGIN + "/api/uploads", { method: "POST", body: good }))).status, 401);
  globalThis.__listUser = owner;
});
test("views count only published pages, and unpublishing hides every old address", async () => {
  await views.POST(new Request(model.SITE_ORIGIN + "/api/views/" + article.id, { method: "POST" }), context(article.id));
  assert.equal((await server.publishedArticle(article.slug)).views, 1);
  const response = await item.PUT(req("PUT", { ...article, published: false }), context(article.id));
  assert.equal(response.status, 200);
  article = (await response.json()).article;
  assert.equal(await server.publishedArticle(article.slug), null);
  assert.equal(await server.publishedArticle("iskusstvo-zamechat"), null);
  await views.POST(new Request(model.SITE_ORIGIN + "/api/views/" + article.id, { method: "POST" }), context(article.id));
  assert.equal(sqlite.prepare("SELECT views FROM articles WHERE id=?").get(article.id).views, 1);
});
test("deleting a page removes all of its URL aliases", async () => {
  assert.equal((await item.DELETE(req("DELETE"), context(article.id))).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM articles").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM paths").get().n, 0);
});
test("interactive article blocks round-trip through the real API", async () => {
  globalThis.__listUser = owner;
  const draft = { ...model.demoArticle(), slug: "interactive-roundtrip", blocks: [
    { id: "short", type: "summary", text: "A concise version" },
    { id: "tasks", type: "checklist", text: "First\nSecond" },
    { id: "extra", type: "details", label: "Sources and reasoning", text: "Details with **emphasis**." },
  ] };
  const response = await collection.POST(req("POST", draft));
  assert.equal(response.status, 201);
  const saved = (await response.json()).article;
  const listed = (await (await collection.GET()).json()).articles.find((a) => a.id === saved.id);
  assert.deepEqual(listed.blocks, draft.blocks);
  await item.DELETE(req("DELETE"), context(saved.id));
  assert.throws(() => model.normalizeArticle({ ...draft, blocks: [{ ...draft.blocks[2], label: "x".repeat(121) }] }));
});
test("heading links survive renaming and reordering; empty headings stay out of the outline", () => {
  const blocks = [{ id: "first", type: "heading", text: "**First section**" }, { id: "second", type: "heading", text: "Second" }, { id: "empty", type: "heading", text: "" }];
  const first = model.articleOutline({ blocks });
  assert.deepEqual(first.map((s) => s.title), ["First section", "Second"]);
  const second = model.articleOutline({ blocks: [blocks[1], { ...blocks[0], text: "Renamed" }] });
  assert.equal(first[0].id, second[1].id);
  assert.equal(first[1].id, second[0].id);
});
test("checklist progress keys follow content instead of silently checking different reordered items", () => {
  const initial = reading.checklistItems("First\nSecond\nFirst");
  assert.equal(new Set(initial.map((i) => i.id)).size, 3);
  const reordered = reading.checklistItems("Inserted\nSecond\nFirst\nFirst");
  assert.equal(initial[1].id, reordered[1].id);
  assert.equal(initial[0].id, reordered[2].id);
  assert.notEqual(initial[0].id, reordered[0].id);
  assert.deepEqual(reading.checklistItems(" - One\n[ ] Two\n• Three\n\n").map((i) => i.label), ["One", "Two", "Three"]);
});
test("notes and reading position reject corrupt cache data and enforce size and anchor limits", () => {
  assert.deepEqual(reading.parseNotes("{"), []);
  assert.deepEqual(reading.parseNotes('{"notes":[]}'), []);
  const note = { id: "n", text: "x".repeat(3000), quote: "q".repeat(2000), section: "javascript:alert(1)", createdAt: 1 };
  const parsed = reading.parseNotes(JSON.stringify(Array.from({ length: 60 }, () => note)));
  assert.equal(parsed.length, 50);
  assert.equal(parsed[0].text.length, 2000);
  assert.equal(parsed[0].quote.length, 1200);
  assert.equal(parsed[0].section, "");
  assert.equal(reading.parseProgress('{"fraction":200,"section":"section-a"}').fraction, 1);
  assert.equal(reading.parseProgress('{"fraction":-5,"section":"x"}').fraction, 0);
  assert.equal(reading.parseProgress('{"fraction":"0.5"}'), null);
  const markdown = reading.notesMarkdown("Title", "https://example.test/a", [{ id: "x", text: "My thought", quote: "Line 1\nLine 2", section: "section-first", createdAt: 1 }]);
  assert.ok(markdown.includes("> Line 1\n> Line 2"));
  assert.ok(markdown.includes("https://example.test/a#section-first"));
});
test("all templates contain valid distinct blocks without injecting content into saved articles", () => {
  for (const kind of ["blank", "article", "guide", "story"]) {
    const template = model.articleTemplate(kind, "Author");
    assert.equal(template.id, undefined);
    assert.equal(template.published, false);
    assert.equal(template.author, "Author");
    assert.equal(new Set(template.blocks.map((b) => b.id)).size, template.blocks.length);
    assert.ok(template.blocks.every((b) => model.BLOCK_TYPES.includes(b.type)));
  }
  assert.ok(model.articleTemplate("guide").blocks.some((b) => b.type === "checklist"));
});
test("reader output contains accessible checklists, safe disclosure labels and a short reading mode", () => {
  const article = { ...model.demoArticle(), id: "reader", blocks: [
    { id: "short", type: "summary", text: "Only the essence" },
    { id: "one", type: "heading", text: "First section" },
    { id: "content", type: "paragraph", text: "Full article body" },
    { id: "tasks", type: "checklist", text: "Task one\nTask two" },
    { id: "extra", type: "details", text: "Hidden information", label: "<img onerror=bad>" },
    { id: "two", type: "heading", text: "Second section" },
  ] };
  const html = renderToStaticMarkup(createElement(ArticleView, { article }));
  assert.ok(html.includes('id="section-one"'));
  assert.ok(html.includes('href="#section-two"'));
  assert.ok(html.includes('type="checkbox"'));
  assert.ok(html.includes("<details"));
  assert.ok(html.includes("&lt;img onerror=bad&gt;"));
  assert.ok(!html.includes("<img onerror=bad>"));
  const brief = renderToStaticMarkup(createElement(ArticleView, { article, summaryOnly: true }));
  assert.ok(brief.includes("Only the essence"));
  assert.ok(!brief.includes("Full article body"));
  const reader = renderToStaticMarkup(createElement(ReaderExperience, { article }));
  assert.ok(reader.includes("Инструменты читателя"));
  assert.ok(reader.includes("Суть за минуту"));
  assert.ok(reader.includes("Мои заметки"));
});
let publicArticle, deletionBackup;
test("public reading is anonymous while drafts and admin APIs stay account-protected", async () => {
  globalThis.__listUser = other;
  const created = await collection.POST(req("POST", { ...model.demoArticle(), title: "Public launch test", slug: "public-launch-check", published: true }));
  assert.equal(created.status, 201);
  publicArticle = (await created.json()).article;
  globalThis.__listUser = null;
  assert.equal((await server.publishedArticle(publicArticle.slug)).id, publicArticle.id);
  assert.equal((await collection.GET()).status, 401);
  assert.equal((await adminApi.GET()).status, 401);
  globalThis.__listUser = other;
  assert.equal((await adminApi.GET()).status, 403);
  globalThis.__listUser = owner;
  assert.equal((await adminApi.GET()).status, 200);
});
test("reports require identity, avoid duplicate queue entries and never expose them to an author", async () => {
  const body = { articleId: publicArticle.id, reason: "spam", details: "Test report" };
  globalThis.__listUser = null;
  assert.equal((await reportApi.POST(req("POST", body))).status, 401);
  globalThis.__listUser = { userId: "reader", email: "reader@example.test" };
  assert.equal((await reportApi.POST(req("POST", body))).status, 201);
  assert.equal((await reportApi.POST(req("POST", body))).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM reports WHERE article_id=?").get(publicArticle.id).n, 1);
  assert.equal((await adminApi.GET()).status, 403);
  globalThis.__listUser = other;
  assert.equal((await adminApi.GET()).status, 403);
  const own = (await (await collection.GET()).json()).articles;
  assert.ok(!JSON.stringify(own).includes("Test report"));
  globalThis.__listUser = owner;
  assert.ok((await (await adminApi.GET()).json()).reports.some((r) => r.details === "Test report"));
});
test("moderation hides all article aliases and cannot be bypassed by its author", async () => {
  globalThis.__listUser = other;
  const rename = await item.PUT(req("PUT", { ...publicArticle, slug: "public-launch-renamed" }), context(publicArticle.id));
  assert.equal(rename.status, 200);
  publicArticle = (await rename.json()).article;
  globalThis.__listUser = owner;
  assert.equal((await adminApi.POST(req("POST", { action: "block", articleId: publicArticle.id, reason: "Review required" }))).status, 200);
  assert.equal(await server.publishedArticle("public-launch-check"), null);
  assert.equal(await server.publishedArticle("public-launch-renamed"), null);
  globalThis.__listUser = other;
  publicArticle = (await (await collection.GET()).json()).articles.find((a) => a.id === publicArticle.id);
  assert.equal(publicArticle.blocked, true);
  assert.equal(publicArticle.blockedReason, "Review required");
  assert.equal((await item.PUT(req("PUT", { ...publicArticle, published: true, blocked: false }), context(publicArticle.id))).status, 403);
  const edit = await item.PUT(req("PUT", { ...publicArticle, title: "Corrected title", published: false }), context(publicArticle.id));
  assert.equal(edit.status, 200);
  globalThis.__listUser = owner;
  assert.equal((await adminApi.POST(req("POST", { action: "unblock", articleId: publicArticle.id }))).status, 200);
  assert.equal(await server.publishedArticle(publicArticle.slug), null);
  globalThis.__listUser = other;
  publicArticle = (await (await collection.GET()).json()).articles.find((a) => a.id === publicArticle.id);
  const republish = await item.PUT(req("PUT", { ...publicArticle, published: true }), context(publicArticle.id));
  assert.equal(republish.status, 200);
  publicArticle = (await republish.json()).article;
  assert.equal((await server.publishedArticle(publicArticle.slug)).title, "Corrected title");
});
test("automatic private backups survive deletion and restore into the original author's account as a draft", async () => {
  globalThis.__listUser = other;
  assert.equal((await item.DELETE(req("DELETE"), context(publicArticle.id))).status, 200);
  deletionBackup = sqlite.prepare("SELECT * FROM backups WHERE article_id=? AND action='delete' ORDER BY created_at DESC").get(publicArticle.id);
  assert.ok(deletionBackup);
  assert.ok(objects.has(deletionBackup.object_key));
  globalThis.__listUser = null;
  assert.equal((await backupApi.GET(new Request(model.SITE_ORIGIN), context(deletionBackup.id))).status, 401);
  globalThis.__listUser = other;
  assert.equal((await backupApi.GET(new Request(model.SITE_ORIGIN), context(deletionBackup.id))).status, 403);
  globalThis.__listUser = owner;
  const downloaded = await backupApi.GET(new Request(model.SITE_ORIGIN), context(deletionBackup.id));
  assert.equal(downloaded.status, 200);
  assert.equal((await downloaded.json()).article.owner_id, other.userId);
  const restore = await backupApi.POST(req("POST", { action: "restore" }), context(deletionBackup.id));
  assert.equal(restore.status, 200);
  assert.equal(sqlite.prepare("SELECT owner_id FROM articles WHERE id=?").get(publicArticle.id).owner_id, other.userId);
  assert.equal(await server.publishedArticle(publicArticle.slug), null);
  assert.ok(!(await (await collection.GET()).json()).articles.some((a) => a.id === publicArticle.id));
});
test("restoring an occupied historical address does not take another author's URL", async () => {
  globalThis.__listUser = other;
  assert.equal((await item.DELETE(req("DELETE"), context(publicArticle.id))).status, 200);
  globalThis.__listUser = owner;
  const created = await collection.POST(req("POST", { ...model.demoArticle(), slug: publicArticle.slug, published: true }));
  assert.equal(created.status, 201);
  const occupant = (await created.json()).article;
  const restore = await backupApi.POST(req("POST", { action: "restore" }), context(deletionBackup.id));
  assert.equal(restore.status, 200);
  const result = await restore.json();
  assert.notEqual(result.slug, publicArticle.slug);
  assert.equal((await server.publishedArticle(publicArticle.slug)).id, occupant.id);
  assert.equal(sqlite.prepare("SELECT owner_id FROM articles WHERE id=?").get(publicArticle.id).owner_id, other.userId);
});
test("rate limits reset in place and backup retention keeps ten recoverable copies", async () => {
  await operations.rateLimit("test-window", 2, 60000);
  await operations.rateLimit("test-window", 2, 60000);
  await assert.rejects(() => operations.rateLimit("test-window", 2, 60000), (e) => e.status === 429 && e.retryAfter > 0);
  sqlite.prepare("UPDATE request_limits SET starts_at=? WHERE key=?").run(Date.now() - 60001, "test-window");
  await operations.rateLimit("test-window", 2, 60000);
  assert.equal(sqlite.prepare("SELECT hits FROM request_limits WHERE key='test-window'").get().hits, 1);
  const row = sqlite.prepare("SELECT * FROM articles WHERE id=?").get(publicArticle.id);
  for (let i = 0; i < 13; i++) await operations.backupArticle(row, "test-retention");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM backups WHERE article_id=?").get(publicArticle.id).n, 10);
  const records = sqlite.prepare("SELECT object_key FROM backups WHERE article_id=?").all(publicArticle.id);
  assert.ok(records.every((b) => objects.has(b.object_key)));
  assert.equal([...objects.keys()].filter((key) => key.startsWith("backups/" + publicArticle.id + "/")).length, 10);
});
test("a failed backup cannot erase or overwrite the current article", async () => {
  globalThis.__listUser = other;
  const current = (await (await collection.GET()).json()).articles.find((a) => a.id === publicArticle.id);
  const oldPut = globalThis.__listEnv.BUCKET.put;
  globalThis.__listEnv.BUCKET.put = async () => { throw new Error("Simulated backup storage outage"); };
  try {
    const response = await item.PUT(req("PUT", { ...current, title: "Must not replace" }), context(current.id));
    assert.equal(response.status, 500);
    assert.equal(sqlite.prepare("SELECT title FROM articles WHERE id=?").get(current.id).title, current.title);
    assert.equal(sqlite.prepare("SELECT version FROM articles WHERE id=?").get(current.id).version, current.version);
  } finally { globalThis.__listEnv.BUCKET.put = oldPut; }
});
test("public editor explains sign-in and never advertises a closed site", () => {
  const html = renderToStaticMarkup(createElement(Editor, { user: null, initial: model.demoArticle(), signIn: "/signin-with-chatgpt?return_to=%2F", signOut: "/", adminAllowed: false }));
  assert.ok(html.includes("Публичный сервис"));
  assert.ok(html.includes("вход через ChatGPT"));
  assert.ok(!html.includes("Закрытая версия"));
  assert.ok(!html.includes("Управление сервисом"));
});
