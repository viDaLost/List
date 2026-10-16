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
  "lib/article.ts", "lib/reading.ts", "lib/object-storage.ts",  "lib/standalone-auth.ts", "lib/browser-access.ts", "lib/client-access.ts", "lib/telegram-identity.ts", "lib/telegram-sources-legacy.ts", "lib/telegram-deploy.ts", "lib/telegram-sources.ts", "lib/server.ts", "lib/operations.ts", "app/components/article-view.tsx", "app/components/article-ending-editor.tsx", "app/components/interactive-blocks.tsx", "app/components/reader-experience.tsx", "app/components/editor.tsx",
  "app/api/articles/route.ts", "app/api/articles/[id]/route.ts", "app/api/slug/route.ts",
  "app/api/uploads/route.ts", "app/media/[id]/route.ts", "app/api/views/[id]/route.ts",
  "app/api/admin/route.ts", "app/api/admin/backups/[id]/route.ts", "app/api/reports/route.ts",
  "app/api/access/route.ts", "app/api/admin/telegram/route.ts", "app/api/telegram/connect/route.ts", "app/api/telegram/session/route.ts", "app/api/telegram/bridge/route.ts",
];
await writeFile(path.join(out, "platform.mjs"), "export const env = globalThis.__listEnv;\n");
await writeFile(path.join(out, "auth.mjs"), `export async function getAuthorUser() { return globalThis.__listUser; } export function authorAccessPath(path) { return "/signin-with-chatgpt?return_to="+encodeURIComponent(path); }\n`);
for (const file of files) {
  let source = await readFile(path.join(root, file), "utf8");
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const replacements = [];
  for (const node of syntax.statements) {
    if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const name = node.moduleSpecifier.text;
    let target;
    if (name === "cloudflare:workers") target = path.join(out, "platform.mjs");
    else if (name === "@/app/author-access") target = path.join(out, "auth.mjs");
    else if (name.startsWith("@/")) target = path.join(out, name.slice(2) + ".mjs");
    else if (name.startsWith(".")) target = path.resolve(out, path.dirname(file), name + ".mjs");
    if (target) replacements.push({ start: node.moduleSpecifier.getStart(syntax), end: node.moduleSpecifier.end, value: JSON.stringify(pathToFileURL(target).href) });
  }
  for (const replacement of replacements.sort((a,b) => b.start-a.start)) source = source.slice(0,replacement.start)+replacement.value+source.slice(replacement.end);
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
const owner = { userId: "owner", email: "owner@example.test", isAdmin: true }, other = { userId: "other", email: "other@example.test" };
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
test("public editor explains browser access without registration", () => {
  const html = renderToStaticMarkup(createElement(Editor, { user: null, initial: model.demoArticle(), signIn: "/signin-with-chatgpt?return_to=%2F", signOut: "/", adminAllowed: false }));
  assert.ok(html.includes("Публичный сервис"));
  assert.ok(html.includes("Ключ редактирования"));
  assert.ok(!html.includes("ChatGPT"));
  assert.ok(!html.includes("Закрытая версия"));
  assert.ok(!html.includes("Управление сервисом"));
});

test("D1 object storage preserves chunked images and private snapshots without R2", async () => {
  const originalBucket=globalThis.__listEnv.BUCKET;
  delete globalThis.__listEnv.BUCKET;
  try {
    const {objectStorage}=await load("lib/object-storage"), storage=objectStorage();
    const id=crypto.randomUUID(), data=crypto.getRandomValues(new Uint8Array(64000));
    const image=new Uint8Array(2200000); for(let i=0;i<image.length;i++) image[i]=data[i%data.length];
    await storage.put(id,image,{httpMetadata:{contentType:"image/png"}});
    const result=await media.GET(new Request(model.SITE_ORIGIN+"/media/"+id),context(id));
    assert.equal(result.status,200); assert.equal(result.headers.get("content-type"),"image/png");
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()),image);
    assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM object_chunks WHERE object_key=?").get(id).n>1);
    const key="backups/"+crypto.randomUUID()+"/snapshot.json";
    await storage.put(key,JSON.stringify({private:true}),{httpMetadata:{contentType:"application/json"}});
    assert.deepEqual(await (await storage.get(key)).json(),{private:true});
    assert.equal((await media.GET(new Request(model.SITE_ORIGIN+"/media/"+key),context(key))).status,404);
    await storage.delete(id); assert.equal(await storage.get(id),null);
    await storage.delete(key);
  } finally { globalThis.__listEnv.BUCKET=originalBucket; }
});

test("passwordless browser keys create isolated authors and cannot forge administrator headers",async()=>{
 const api=await load("app/api/access/route"),access=await load("lib/browser-access"),{standaloneRequest}=await load("lib/standalone-auth");
 const createRequest=()=>new Request(model.SITE_ORIGIN+"/api/access",{method:"POST",headers:{"Content-Type":"application/json",origin:model.SITE_ORIGIN,"cf-connecting-ip":"192.0.2.10"},body:JSON.stringify({action:"create"})});
 const a=await api.POST(createRequest()),b=await api.POST(createRequest());assert.equal(a.status,200);assert.equal(b.status,200);
 const first=await a.json(),second=await b.json();assert.notEqual(first.user.userId,second.user.userId);assert.equal(first.user.isAdmin,false);
 const cookie=a.headers.get("set-cookie").split(";")[0];assert.match(a.headers.get("set-cookie"),/Secure; HttpOnly; SameSite=Lax/);
 const request=new Request(model.SITE_ORIGIN+"/api/admin",{headers:{cookie,"oai-authenticated-user-id":"owner","oai-authenticated-user-admin":"1"}});
 const prepared=await standaloneRequest(request);assert.equal(prepared.headers.get("oai-authenticated-user-id"),first.user.userId);assert.equal(prepared.headers.get("oai-authenticated-user-admin"),"0");
 const forged=await standaloneRequest(new Request(model.SITE_ORIGIN+"/api/admin",{headers:{"oai-authenticated-user-id":"owner","oai-authenticated-user-admin":"1"}}));assert.equal(forged.headers.get("oai-authenticated-user-id"),null);
 const key=cookie.split("=")[1];assert.equal((await access.lookupAccessKey(key)).id,first.user.userId);assert.equal(await access.lookupAccessKey("bad"),null);
 const exportRequest=new Request(model.SITE_ORIGIN+"/api/access",{method:"POST",headers:{cookie,"Content-Type":"application/json",origin:model.SITE_ORIGIN},body:JSON.stringify({action:"export"})});assert.equal((await api.POST(exportRequest)).status,400);
 const ticket=await access.issueAccessLink(first.user.userId),restored=await access.redeemAccessLink(ticket);assert.equal(restored.author.id,first.user.userId);assert.notEqual(restored.key,key);await assert.rejects(()=>access.redeemAccessLink(ticket));
 const expired=await access.issueAccessLink(first.user.userId,"restore",-1);await assert.rejects(()=>access.redeemAccessLink(expired));
 const wrongKind=await access.issueAccessLink(first.user.userId,"connect");await assert.rejects(()=>access.redeemAccessLink(wrongKind));
});

test("Telegram identity is automatic, independent of browsers and inaccessible to other IDs",async()=>{
 const api=await load('app/api/telegram/bridge/route'),access=await load('lib/browser-access'),identity=await load('lib/telegram-identity'),{standaloneRequest}=await load('lib/standalone-auth');
 const secret='private-tg-bridge-'.repeat(3);globalThis.__listEnv.TELEGRAM_BRIDGE_SECRET=secret;
 const call=(body,credential=secret)=>api.POST(new Request(model.SITE_ORIGIN+'/api/telegram/bridge',{method:'POST',headers:{'Content-Type':'application/json','X-List-Bridge':credential},body:JSON.stringify(body)}));
 const browser=await access.createAuthor();
 try{
  assert.equal((await call({action:'start',telegramId:24680},'wrong')).status,403);
  const first=await (await call({action:'start',telegramId:24680})).json(),again=await (await call({action:'start',telegramId:24680})).json();assert.equal(first.authorId,again.authorId);assert.notEqual(first.authorId,browser.author.id);
  assert.equal((await call({action:'bind',telegramId:24680,token:'anything'})).status,400);
  const tg=await identity.telegramAuthor('24680'),tgKey=await identity.telegramSession(tg);
  const cookies='__Host-list-author='+browser.key+'; __Host-list-telegram-author='+tgKey;
  const ordinary=await standaloneRequest(new Request(model.SITE_ORIGIN,{headers:{cookie:cookies}}));assert.equal(ordinary.headers.get('oai-authenticated-user-id'),browser.author.id);
  const embedded=await standaloneRequest(new Request(model.SITE_ORIGIN,{headers:{cookie:cookies,'x-list-context':'telegram'}}));assert.equal(embedded.headers.get('oai-authenticated-user-id'),tg.id);
  const forged=await standaloneRequest(new Request(model.SITE_ORIGIN,{headers:{cookie:'__Host-list-author='+browser.key,'x-list-context':'telegram','oai-authenticated-user-id':tg.id}}));assert.equal(forged.headers.get('oai-authenticated-user-id'),null);
  const switched=await standaloneRequest(new Request(model.SITE_ORIGIN,{headers:{cookie:'__Host-list-author='+tgKey}}));assert.equal(switched.headers.get('oai-authenticated-user-id'),null);
  globalThis.__listUser={userId:browser.author.id};const browserPage=await (await collection.POST(req('POST',{...model.demoArticle(),slug:'browser-stays-separate'}))).json();
  globalThis.__listUser={userId:tg.id};const tgPage=await (await collection.POST(req('POST',{...model.demoArticle(),slug:'tg-private-draft'}))).json();
  const list=await (await call({action:'articles',telegramId:24680})).json();assert.ok(list.articles.some(a=>a.id===tgPage.article.id));assert.ok(!list.articles.some(a=>a.id===browserPage.article.id));assert.ok(!JSON.stringify(list).includes('24680'));
  assert.equal((await call({action:'delete',telegramId:24681,articleId:tgPage.article.id,version:1})).status,404);
  assert.equal((await call({action:'delete',telegramId:24680,articleId:tgPage.article.id,version:2})).status,409);
  assert.equal((await call({action:'delete',telegramId:24680,articleId:tgPage.article.id,version:1})).status,200);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM articles WHERE id=?').get(tgPage.article.id).n,0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM backups WHERE article_id=? AND owner_id=?').get(tgPage.article.id,tg.id).n,1);
 }finally{delete globalThis.__listEnv.TELEGRAM_BRIDGE_SECRET;globalThis.__listUser=owner;}
});

test('Mini App validates Telegram signatures, age, bot and identity rather than trusting client IDs',async()=>{
 const {verifyTelegramData}=await load('lib/telegram-identity');
 const key=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),pub=Buffer.from(await crypto.subtle.exportKey('raw',key.publicKey)).toString('hex'),now=Date.now(),bot='123456789';
 async function sign(fields){const params=new URLSearchParams(fields),pairs=[...params].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v);params.set('signature',Buffer.from(await crypto.subtle.sign('Ed25519',key.privateKey,new TextEncoder().encode(bot+':WebAppData\n'+pairs.join('\n')))).toString('base64url'));return params.toString();}
 const valid=await sign({auth_date:String(Math.floor(now/1000)),user:JSON.stringify({id:234567,first_name:'Test'})});assert.equal(await verifyTelegramData(valid,bot,now,pub),'234567');
 await assert.rejects(()=>verifyTelegramData(valid,'other-bot',now,pub));await assert.rejects(()=>verifyTelegramData(valid,bot,now+2*86400000,pub));
 const altered=new URLSearchParams(valid);altered.set('user',JSON.stringify({id:234568}));await assert.rejects(()=>verifyTelegramData(altered.toString(),bot,now,pub));
 await assert.rejects(()=>verifyTelegramData(valid+'&user=%7B%22id%22%3A1%7D',bot,now,pub));
 await assert.rejects(()=>verifyTelegramData(valid,bot,now));
 const session=await load('app/api/telegram/session/route');sqlite.prepare("INSERT INTO settings (key,value) VALUES ('telegram_bot_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(bot);
 const result=await session.POST(req('POST',{initData:valid}));assert.equal(result.status,401);assert.equal(result.headers.get('set-cookie'),null);
});

test('native Telegram menus, edit links and confirmed deletion use the platform user ID',async()=>{
 const dir=path.join(out,'telegram-menu');await mkdir(path.join(dir,'lib'),{recursive:true});await mkdir(path.join(dir,'handlers'),{recursive:true});
 const sdk=path.join(dir,'sdk.js');await writeFile(sdk,'export const api=globalThis.__tgMenu.api,db=globalThis.__tgMenu.db,fetch=globalThis.__tgMenu.fetch;');
 for(const name of ['lib/bridge.js','lib/menu.js','handlers/message.js','handlers/callback_query.js']){let source=await readFile(path.join(root,'telegram-bot/tgcloud',name),'utf8');source=source.replace("from 'sdk'",'from '+JSON.stringify(pathToFileURL(sdk).href));await writeFile(path.join(dir,name),source);}
 const bridgeApi=await load('app/api/telegram/bridge/route'),secret='tg-native-menu-'.repeat(4),sent=[],answered=[];globalThis.__listEnv.TELEGRAM_BRIDGE_SECRET=secret;
 globalThis.__tgMenu={api:{async sendMessage(v){sent.push(v);},async answerCallbackQuery(v){answered.push(v);}},db:{async get(){return {value:secret};},async run(){}},async fetch(url,init){return bridgeApi.POST(new Request(url,init));}};
 try{
  const {default:message}=await import(pathToFileURL(path.join(dir,'handlers/message.js')).href),{default:callback}=await import(pathToFileURL(path.join(dir,'handlers/callback_query.js')).href);
  await message({chat:{type:'group',id:-1},from:{id:334455},text:'/start'});assert.equal(sent.length,0);
  await message({chat:{type:'private',id:334455},from:{id:334455},text:'/start'});
  assert.deepEqual(sent[0].reply_markup.inline_keyboard.map(row=>row[0].text),['Мои статьи','Новая статья','Удалить статью']);assert.ok(sent[0].reply_markup.inline_keyboard[1][0].web_app.url.includes('screen=new'));assert.ok(!JSON.stringify(sent.map(m=>m.text)).includes('334455'));
  const a=sqlite.prepare('SELECT id FROM authors WHERE telegram_id=?').get('334455');globalThis.__listUser={userId:a.id};const created=await (await collection.POST(req('POST',{...model.demoArticle(),slug:'native-menu-article',published:true}))).json();
  await message({chat:{type:'private',id:334455},from:{id:334455},text:'/articles'});assert.ok(JSON.stringify(sent.at(-1)).includes('screen=edit'));assert.ok(JSON.stringify(sent.at(-1)).includes('screen=read'));
  const q=(data,id=334455)=>({id:'query',from:{id},message:{chat:{type:'private',id}},data});
  await callback(q('remove:'+created.article.id,334456));assert.ok(!JSON.stringify(sent.at(-1)).includes('confirm:'));
  await callback(q('remove:'+created.article.id));const confirm=sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data;assert.ok(confirm.startsWith('confirm:'));assert.ok(sqlite.prepare('SELECT id FROM articles WHERE id=?').get(created.article.id));
  await callback(q(confirm));assert.equal(sqlite.prepare('SELECT id FROM articles WHERE id=?').get(created.article.id),undefined);assert.ok(answered.length>=3);
 }finally{delete globalThis.__tgMenu;delete globalThis.__listEnv.TELEGRAM_BRIDGE_SECRET;globalThis.__listUser=owner;}
});

test("phone setup deploys Telegram Serverless without persisting the CLI token",async()=>{
 const {deployTelegramBot}=await load("lib/telegram-deploy"),{telegramSources}=await load("lib/telegram-sources");
 const token="app123:"+"x".repeat(32),secret="bridge-".repeat(8),calls=[];let migrated=false,runs=0,webhook=false;
 const transport=async(url,options)=>{const path=new URL(url).pathname.replace('/app123/manage','');const body=options.body?JSON.parse(options.body):undefined;calls.push({url,path,options,body});let result;
  if(path==='/get')result={revision:7,canonical_modules:{}};
  else if(path==='/migrate'&&options.method==='GET')result={db_changes:migrated?[]:[{kind:'create_table',table:'settings',status:'good'},{kind:'create_table',table:'users',status:'good'}]};
  else if(path==='/migrate'&&body.dry_run)result={db_changes:[{kind:'create_table',table:'settings',status:'good'},{kind:'create_table',table:'users',status:'good'}]};
  else if(path==='/migrate'){assert.deepEqual(body.apply,['create_table:settings','create_table:users']);assert.equal(body.schema,undefined);migrated=true;result={};}
  else if(path==='/deploy'){assert.equal(body.expected_revision,7);assert.deepEqual(body.changed_sources,telegramSources);result={revision:8};}
  else if(path==='/run'){assert.ok(migrated);assert.equal(body.module,'handlers/message');assert.ok(body.sources['handlers/message'].includes(runs++?"SELECT count(*) AS count FROM users":"import setup from '../lib/setup.js'"));assert.notEqual(body.sources['handlers/message'],telegramSources['handlers/message']);assert.equal(body.args.bridgeSecret,secret);result={result:{ready:true,username:'list_test_bot'}};}
  else if(path==='/webhook/sync'){webhook=true;result={in_sync:true};}
  else if(path==='/webhook')result={in_sync:webhook};
  else throw new Error('Unexpected call');
  return Response.json({ok:true,result});
 };
 assert.deepEqual(await deployTelegramBot(token,secret,transport),{username:'list_test_bot',appId:'app123'});assert.equal(calls.length,11);assert.equal(runs,2);
 for(const call of calls){assert.equal(call.options.headers.Authorization,'Bearer '+token);assert.ok(!call.url.includes(token));assert.ok(!JSON.stringify(call.body||{}).includes(token));assert.equal(new URL(call.url).origin,'https://cloud.telegram.org');assert.equal(call.options.redirect,'manual');assert.equal(call.options.cache,'no-store');}
});

test('setup refuses to run a bot while live migrations are pending or unverified',async()=>{
 const {deployTelegramBot}=await load('lib/telegram-deploy');
 for(const live of [{db_changes:[{status:'good',kind:'create_table',table:'settings'}]},{}]){
  let runs=0;
  const transport=async(url,options)=>{
   const p=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};
   if(p.endsWith('/get'))return Response.json({ok:true,result:{revision:1,canonical_modules:{}}});
   if(p.endsWith('/migrate')&&options.method==='GET')return Response.json({ok:true,result:live});
   if(p.endsWith('/migrate')&&body.dry_run)return Response.json({ok:true,result:{db_changes:[]}});
   if(p.endsWith('/run'))runs++;
   return Response.json({ok:true,result:{}});
  };
  await assert.rejects(()=>deployTelegramBot('app123:x','s'.repeat(40),transport),/таблиц|создал таблицы/);assert.equal(runs,0);
 }
});

test('webhook completion uses read-back and resumes without losing pending messages',async()=>{
 const {deployTelegramBot}=await load('lib/telegram-deploy');
 for(const scenario of ['already-active','empty-success','active-after-sync-error','transient-error','permanent-error']){
  let synced=scenario==='already-active',syncs=0,runs=0;
  const transport=async(url,options)=>{
   const p=new URL(url).pathname;
   if(p.endsWith('/get'))return Response.json({ok:true,result:{revision:3,canonical_modules:{}}});
   if(p.endsWith('/migrate'))return Response.json({ok:true,result:{db_changes:[]}});
   if(p.endsWith('/run')){runs++;return Response.json({ok:true,result:{result:{ready:true,username:'list_test_bot'}}});}
   if(p.endsWith('/webhook/sync')){
    syncs++;assert.deepEqual(JSON.parse(options.body),{});
    if(scenario==='already-active')throw new Error('Must not sync an active webhook');
    if(scenario==='permanent-error')return Response.json({ok:false,description:'app123:x'},{status:400});
    if(scenario==='transient-error'&&syncs===1)return Response.json({ok:false},{status:503});
    synced=true;
    if(scenario==='active-after-sync-error')return Response.json({ok:false},{status:500});
    return Response.json({ok:true});
   }
   if(p.endsWith('/webhook'))return Response.json({ok:true,result:{in_sync:synced}});
   return Response.json({ok:true,result:{}});
  };
  const result=deployTelegramBot('app123:x','s'.repeat(40),transport);
  if(scenario==='permanent-error')await assert.rejects(()=>result,error=>error.message.includes('HTTP 400')&&!error.message.includes('app123:x'));
  else assert.equal((await result).username,'list_test_bot');
  assert.equal(runs,2);assert.equal(syncs,scenario==='already-active'?0:scenario==='transient-error'?2:1);
 }
});

test('Telegram setup rejects redirects without forwarding credentials',async()=>{
 const {deployTelegramBot}=await load('lib/telegram-deploy');
 for(const status of [301,302,303,307,308]){
  let calls=0;
  await assert.rejects(()=>deployTelegramBot('app123:secret','bridge-'.repeat(8),async(url,options)=>{
   calls++;assert.equal(options.redirect,'manual');
   return new Response(null,{status,headers:{Location:'https://example.com/steal'}});
  }),/перенаправление/);
  assert.equal(calls,1);
 }
});

test("phone setup refuses existing bots, unsafe migrations and invalid credentials before writing",async()=>{
 const {deployTelegramBot}=await load('lib/telegram-deploy'),token='app123:'+"z".repeat(32),secret='bridge-'.repeat(8);
 let writes=0;
 await assert.rejects(()=>deployTelegramBot('123:ordinary-bot-token',secret,async()=>{writes++;}),/CLI/);assert.equal(writes,0);
 await assert.rejects(()=>deployTelegramBot(token,secret,async()=>Response.json({ok:true,result:{revision:1,canonical_modules:{'handlers/message':'another bot'}}})),/другой проект/);
 const transport=async(url,options)=>{if(url.endsWith('/get'))return Response.json({ok:true,result:{revision:1,canonical_modules:{}}});if(url.endsWith('/migrate')&&JSON.parse(options.body).dry_run)return Response.json({ok:true,result:{db_changes:[{status:'warning',kind:'drop_table',table:'important'}]}});writes++;throw new Error('Must not write');};
 await assert.rejects(()=>deployTelegramBot(token,secret,transport),/несовместимые/);assert.equal(writes,0);
 await assert.rejects(()=>deployTelegramBot(token,secret,async()=>Response.json({ok:false,description:token},{status:403})),error=>!error.message.includes(token)&&error.message.includes('не принял'));
});

test("Telegram setup API is restricted to the service owner",async()=>{
 const setup=await load('app/api/admin/telegram/route'),previous=globalThis.__listUser;
 try{globalThis.__listUser=null;assert.equal((await setup.POST(req('POST',{token:'not-real'}))).status,401);globalThis.__listUser=other;assert.equal((await setup.POST(req('POST',{token:'not-real'}))).status,403);globalThis.__listUser=owner;assert.equal((await setup.POST(req('POST',{token:'not-real'},'https://evil.test'))).status,403);}finally{globalThis.__listUser=previous;}
});

test('block colors, page background and up to five footer buttons survive publish, backup and restore',async()=>{
 globalThis.__listUser=owner;
 const styled={...model.demoArticle(),slug:'colored-footer-test',background:'#ddeeff',footer:{text:'Моя подпись',mark:'',buttons:Array.from({length:5},(_,i)=>({label:'Кнопка '+(i+1),url:'https://example.com/'+i}))},blocks:[{id:'colored',type:'paragraph',text:'Цветной блок',background:'#ffdddd',color:'#112233'}],published:true};
 const made=await collection.POST(req('POST',styled));assert.equal(made.status,201);const created=(await made.json()).article;
 assert.equal(created.background,styled.background);assert.deepEqual(created.footer,styled.footer);assert.equal(created.blocks[0].color,'#112233');
 const read=await item.GET(req('GET'),context(created.id));assert.deepEqual((await read.json()).article.footer,styled.footer);
 globalThis.__listUser=other;assert.equal((await item.GET(req('GET'),context(created.id))).status,404);globalThis.__listUser=owner;
 const publicPage=await server.publishedArticle(styled.slug);const html=renderToStaticMarkup(createElement(ArticleView,{article:publicPage}));assert.ok(html.includes('--paper:#ddeeff'));assert.ok(html.includes('background:#ffdddd'));assert.ok(html.includes('color:#112233'));assert.ok(!html.includes('Спасибо, что прочитали'));assert.equal((html.match(/>Кнопка /g)||[]).length,5);
 for(const bad of [{...styled,background:'red;display:none'},{...styled,blocks:[{...styled.blocks[0],color:'url(javascript:alert(1))'}]},{...styled,footer:{...styled.footer,buttons:Array(6).fill(styled.footer.buttons[0])}},{...styled,footer:{...styled.footer,buttons:[{label:'X',url:'javascript:alert(1)'}]}}])assert.throws(()=>model.normalizeArticle(bad));
 const empty=model.normalizeArticle({...styled,footer:{text:'',mark:'',buttons:[]}});assert.ok(!renderToStaticMarkup(createElement(ArticleView,{article:empty})).includes('article-end'));
 assert.equal((await item.DELETE(req('DELETE'),context(created.id))).status,200);
 const backup=sqlite.prepare('SELECT id FROM backups WHERE article_id=? ORDER BY created_at DESC LIMIT 1').get(created.id);assert.equal((await backupApi.POST(req('POST',{action:'restore'}),context(backup.id))).status,200);
 const restored=(await item.GET(req('GET'),context(created.id)));const data=(await restored.json()).article;assert.deepEqual(data.footer,styled.footer);assert.equal(data.background,styled.background);assert.equal(data.published,false);
});

test('reader edit control belongs to the owner and publication action sits after editor content',()=>{
 const article=model.demoArticle(),ownerHtml=renderToStaticMarkup(createElement(ReaderExperience,{article,canEdit:true,editHref:'/?article=owned'})),publicHtml=renderToStaticMarkup(createElement(ReaderExperience,{article,canEdit:false}));
 assert.ok(ownerHtml.includes('Редактировать'));assert.ok(!publicHtml.includes('Редактировать'));
 const editor=renderToStaticMarkup(createElement(Editor,{user:owner,initial:article,signIn:'/access',signOut:'/access'}));assert.ok(!editor.includes('publish-top'));assert.ok(editor.indexOf('article-publish-bottom')>editor.indexOf('editable-blocks'));assert.ok(editor.includes('Окончание статьи'));assert.ok(editor.includes('Фон этого блока'));
});
