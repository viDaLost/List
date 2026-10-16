import { objectStorage } from "@/lib/object-storage";
import { admin, audit, backupArticle, rateLimit } from "@/lib/operations";
import { endpoint, sql, readBody, HttpError, fromRow, articleValues, type ArticleRow } from "@/lib/server";
import { normalizeArticle, suggestSlug } from "@/lib/article";
type Context = { params: Promise<{ id: string }> };
type BackupRow = { id: string; article_id: string; object_key: string; title: string };
async function findBackup(id: string) {
  const record = await sql().prepare("SELECT * FROM backups WHERE id=?").bind(id).first<BackupRow>();
  if (!record) throw new HttpError(404, "Резервная версия не найдена.");
  const object = await objectStorage().get(record.object_key);
  if (!object) throw new HttpError(404, "Файл резервной версии недоступен.");
  return { record, object };
}
export async function GET(_request: Request, context: Context) {
  return endpoint(async () => {
    await admin();
    const { id } = await context.params, { record, object } = await findBackup(id);
    return new Response(object.body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="article-' + record.article_id + '.json"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const user = await admin(), body = await readBody(request);
    if (body.action !== "restore") throw new HttpError(400, "Подтвердите восстановление.");
    await rateLimit("restore:" + user.userId, 10, 60000);
    const { id } = await context.params, { record, object } = await findBackup(id);
    const snapshot = await object.json<{ format: number; article: ArticleRow; paths: string[] }>();
    if (snapshot.format !== 1 || snapshot.article.id !== record.article_id) throw new HttpError(400, "Формат резервной версии не поддерживается.");
    const old = snapshot.article, db = sql();
    const current = await db.prepare("SELECT * FROM articles WHERE id=?").bind(old.id).first<ArticleRow>();
    const restored = normalizeArticle({ ...fromRow(old), published: false });
    const conflict = await db.prepare("SELECT article_id FROM paths WHERE slug=?").bind(restored.slug).first<{ article_id: string }>();
    if (conflict && conflict.article_id !== old.id) restored.slug = suggestSlug(restored.title).slice(0,40) + "-restored-" + crypto.randomUUID().slice(0,6);
    const now = Date.now();
    if (current) {
      await backupArticle(current, "before-restore");
      const results = await db.batch([
        db.prepare("INSERT INTO paths (slug, article_id, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id=? AND version=?) ON CONFLICT(slug) DO NOTHING").bind(restored.slug, old.id, now, old.id, current.version),
        db.prepare("UPDATE articles SET title=?, author=?, subtitle=?, slug=?, blocks=?, cover=?, theme=?, font=?, accent=?, alignment=?, wide=?, share_title=?, share_description=?, share_image=?, published=?, appearance=?, updated_at=?, version=version+1 WHERE id=? AND version=? AND EXISTS (SELECT 1 FROM paths WHERE slug=? AND article_id=articles.id)").bind(...articleValues(restored), now, old.id, current.version, restored.slug),
      ]);
      if (!results[1].meta.changes) throw new HttpError(409, "Автор уже изменил статью. Обновите список перед восстановлением.");
    } else {
      await db.batch([
        db.prepare("INSERT INTO articles (id, owner_id, title, author, subtitle, slug, blocks, cover, theme, font, accent, alignment, wide, share_title, share_description, share_image, published, appearance, created_at, updated_at, version, views, moderation_blocked, moderation_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(old.id, old.owner_id, ...articleValues(restored), old.created_at, now, old.version + 1, old.views, old.moderation_blocked || 0, old.moderation_reason || ""),
        db.prepare("INSERT INTO paths (slug, article_id, created_at) VALUES (?, ?, ?)").bind(restored.slug, old.id, now),
      ]);
    }
    for (const slug of (snapshot.paths || []).slice(0,200)) {
      if (slug !== restored.slug) await db.prepare("INSERT INTO paths (slug, article_id, created_at) VALUES (?, ?, ?) ON CONFLICT(slug) DO NOTHING").bind(slug, old.id, now).run();
    }
    await audit(user.userId, "restore", old.id, record.id);
    return Response.json({ ok: true, slug: restored.slug, message: "Версия восстановлена как черновик в аккаунте исходного автора." });
  });
}
